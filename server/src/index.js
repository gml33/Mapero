import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { buildTerritories } from './territories.js';
import { register, login, requireAuth } from './auth.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || 'mapero_dev_key';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// ---- Servir la página web ----
app.use(express.static(path.join(__dirname, '../public')));

// ---- Autenticación ----
app.post('/api/auth/register', async (req, res) => {
  try {
    const { token, username } = await register(req.body?.username, req.body?.password);
    res.status(201).json({ token, username });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { token, username } = await login(req.body?.username, req.body?.password);
    res.json({ token, username });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Anti-cheat: velocidad máxima plausible (m/s). 40 m/s ≈ 144 km/h. ----
const MAX_SPEED_MPS = 40;
// Última posición conocida por usuario (para detectar teletransportes).
const lastPos = new Map();

function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function antiCheat(userId, lat, lon, tsMs) {
  const prev = lastPos.get(userId);
  let allowed = true;
  if (prev) {
    const dtS = (tsMs - prev.ts) / 1000;
    if (dtS > 0) {
      const speed = haversineM(prev.lat, prev.lon, lat, lon) / dtS;
      if (speed > MAX_SPEED_MPS) allowed = false;
    }
  }
  if (allowed && (!prev || tsMs >= prev.ts)) {
    lastPos.set(userId, { lat, lon, ts: tsMs });
  }
  return allowed;
}

// ---- Ingesta de mediciones (requiere sesión) ----
app.post('/api/measurements', requireAuth, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body
    : Array.isArray(req.body?.measurements) ? req.body.measurements : null;

  if (!list || list.length === 0) {
    return res.status(400).json({ error: 'Enviar un array de mediciones' });
  }

  const valid = list.filter(m =>
    m && m.bssid && Number.isFinite(m.latitude) && Number.isFinite(m.longitude)
        && Number.isFinite(m.rssi));

  if (valid.length === 0) {
    return res.status(400).json({ error: 'Mediciones inválidas' });
  }

  try {
    const inserted = [];
    let dropped = 0;
    for (const m of valid) {
      const ts = new Date(m.timestamp || Date.now()).getTime();
      if (!antiCheat(req.user.id, m.latitude, m.longitude, ts)) {
        dropped++;
        continue;
      }
      const r = await pool.query(
        `INSERT INTO measurements
           (user_id, bssid, ssid, latitude, longitude, rssi, frequency, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING bssid, ssid, latitude, longitude, rssi, frequency, ts`,
        [req.user.id, m.bssid, m.ssid || '', m.latitude, m.longitude, m.rssi,
         m.frequency || null, new Date(ts)]);
      inserted.push(r.rows[0]);
    }

    if (inserted.length > 0) {
      broadcast({ type: 'measurements', data: inserted });
    }
    res.json({ ok: true, inserted: inserted.length, dropped });
  } catch (e) {
    console.error('[api] error ingesta:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Redes agregadas (carga inicial para la web) ----
app.get('/api/networks', async (_req, res) => {
  try {
    const key = `COALESCE(NULLIF(ssid, ''), bssid)`;
    const { rows } = await pool.query(
      `SELECT ${key} AS name,
              AVG(latitude)  AS latitude,
              AVG(longitude) AS longitude,
              AVG(rssi)      AS rssi,
              COUNT(*)       AS samples,
              MAX(ts)        AS last_seen
       FROM measurements
       GROUP BY ${key}
       ORDER BY last_seen DESC`);
    res.json(rows);
  } catch (e) {
    console.error('[api] error networks:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Territorios del juego de conquista ----
app.get('/api/territories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.user_id, u.username AS name, m.latitude, m.longitude, m.ts
       FROM measurements m
       JOIN users u ON u.id = m.user_id
       WHERE m.ts > now() - interval '30 days'`);
    const territories = buildTerritories(rows);
    res.json(territories);
  } catch (e) {
    console.error('[api] error territories:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Leaderboard (conquistas por jugador) ----
app.get('/api/leaderboard', async (_req, res) => {
  try {
    // Se calcula con el mismo modelo de territorios para no duplicar lógica.
    const terr = await pool.query(
      `SELECT m.user_id, u.username AS name, m.latitude, m.longitude, m.ts
       FROM measurements m JOIN users u ON u.id = m.user_id
       WHERE m.ts > now() - interval '30 days'`);
    const territories = buildTerritories(terr.rows);

    const perUser = new Map();
    for (const t of territories) {
      const acc = perUser.get(t.owner) || { username: t.owner, cells: 0, coverage: 0 };
      acc.cells++;
      acc.coverage += t.score;
      perUser.set(t.owner, acc);
    }
    const list = [...perUser.values()].sort((a, b) => b.coverage - a.coverage);
    res.json(list.map((u, i) => ({ rank: i + 1, ...u })));
  } catch (e) {
    console.error('[api] error leaderboard:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Última posición medida (para centrar el mapa inicial) ----
app.get('/api/last-position', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT latitude, longitude FROM measurements
       ORDER BY ts DESC LIMIT 1`);
    if (rows.length === 0) return res.json(null);
    res.json({ latitude: rows[0].latitude, longitude: rows[0].longitude });
  } catch (e) {
    console.error('[api] error last-position:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- WebSocket en tiempo real ----
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', message: 'conectado' }));
});

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

await initDb();
server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  console.log(`[server] ws://localhost:${PORT}/ws`);
});
