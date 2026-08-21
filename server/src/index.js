import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { buildTerritories } from './territories.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || 'mapero_dev_key';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// ---- Servir la página web ----
app.use(express.static(path.join(__dirname, '../public')));

// ---- Auth de escritura ----
function checkKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'API key inválida' });
  }
  next();
}

// ---- Ingesta de mediciones ----
app.post('/api/measurements', checkKey, async (req, res) => {
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
    // Auto-registro del jugador según su nombre (identidad de la competencia).
    const playerName = (req.headers['x-device-name'] || 'jugador').slice(0, 40);
    const dev = await pool.query(
      'INSERT INTO devices (name, api_key) VALUES ($1, $2) ' +
      'ON CONFLICT (name) DO UPDATE SET api_key = EXCLUDED.api_key ' +
      'RETURNING id', [playerName, API_KEY]);
    const deviceId = dev.rows[0].id;

    const inserted = [];
    for (const m of valid) {
      const r = await pool.query(
        `INSERT INTO measurements
           (device_id, bssid, ssid, latitude, longitude, rssi, frequency, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING bssid, ssid, latitude, longitude, rssi, frequency, ts`,
        [deviceId, m.bssid, m.ssid || '', m.latitude, m.longitude, m.rssi,
         m.frequency || null, new Date(m.timestamp || Date.now())]);
      inserted.push(r.rows[0]);
    }

    broadcast({ type: 'measurements', data: inserted });
    res.json({ ok: true, inserted: inserted.length });
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
      `SELECT m.device_id, d.name, m.latitude, m.longitude, m.ts
       FROM measurements m
       JOIN devices d ON d.id = m.device_id
       WHERE m.ts > now() - interval '30 days'`);
    res.json(buildTerritories(rows));
  } catch (e) {
    console.error('[api] error territories:', e);
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
