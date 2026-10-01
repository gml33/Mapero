import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { buildTerritories, territoryOptions } from './territories.js';
import { register, login, requireAuth, requireAdmin, createUser, setUserRole, setUserPassword } from './auth.js';
import { getSettings, updateSettings, appConfig } from './config.js';
import { rowFilters, networkPredicate, aggregatedOpenSql, aggregatedBandSql, signalWeightSql } from './filters.js';
import { TtlCache } from './cache.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || 'mapero_dev_key';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// ---- Servir la página web ----
app.use(express.static(path.join(__dirname, '../public')));
app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html')));

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
// Desplazamiento máximo tolerado cuando no hay intervalo con el que calcular una
// velocidad (mismo timestamp, o timestamp anterior). La app nunca se mueve
// dentro de un lote, así que 30 m es holgado: solo cubre el ruido del GPS.
const MAX_STEP_M = 30;
// Última posición conocida por usuario (para detectar teletransportes).
const lastPos = new Map();
// Filas por sentencia de inserción. Postgres admite 65535 parámetros y cada
// fila usa 9, así que el límite real es mucho más alto; 500 deja las sentencias
// cómodamente chicas.
const INSERT_CHUNK = 500;

// ---- Agregados cacheados ----
// La agregación por red y el reparto de territorios recorren la tabla entera
// (~114 ms con 43k filas). Se calculan una vez y se_invalidan con cada ingesta,
// así el costo no se multiplica por la cantidad de clientes ni por cada cambio
// de filtro. La ingesta invalida, el TTL es solo la red de seguridad.
const networksCache = new TtlCache(Number(process.env.NETWORKS_TTL_MS) || 10000);
const territoriesCache = new TtlCache(Number(process.env.TERRITORIES_TTL_MS) || 10000);
const settingsCache = new TtlCache(10000);

function invalidateCaches() {
  networksCache.invalidate();
  territoriesCache.invalidate();
  settingsCache.invalidate();
}

/** Ajustes de la partida, validados y acotados. */
async function territorySettings() {
  return settingsCache.resolve('territory', async () =>
    territoryOptions(await getSettings()));
}

/** Filas de los últimos días que alimentan el juego de conquista. */
async function territoryRows() {
  const { rows } = await pool.query(
    `SELECT m.user_id, u.username AS name, m.latitude, m.longitude, m.ts
     FROM measurements m
     JOIN users u ON u.id = m.user_id
     WHERE m.ts > now() - interval '30 days'`);
  return rows;
}

/** Territorios calculados. Lo comparten /territories, /leaderboard y /admin/stats. */
function loadTerritories() {
  return territoriesCache.resolve('territories', async () =>
    buildTerritories(await territoryRows(), await territorySettings()));
}

/**
 * Una fila por red (nombre de SSID, o BSSID si no tiene), agregada sobre todas
 * sus mediciones. Se calcula una vez y se filtra en memoria.
 */
async function aggregateNetworks() {
  const key = `COALESCE(NULLIF(m.ssid, ''), m.bssid)`;
  // Centroide ponderado por señal. Si todas las muestras pesan 0 (señal muy
  // débil) cae al promedio simple, para no dividir por cero ni devolver NaN.
  const w = signalWeightSql('m');
  const centroid = (col) => `CASE WHEN SUM(${w}) > 0
      THEN SUM(${col} * ${w}) / SUM(${w}) ELSE AVG(${col}) END::double precision`;

  const { rows } = await pool.query(
    `SELECT ${key} AS name,
            ${centroid('m.latitude')}  AS latitude,
            ${centroid('m.longitude')} AS longitude,
            AVG(m.rssi)::double precision      AS rssi,
            COUNT(*)::int         AS samples,
            MAX(m.ts)             AS last_seen,
            (${aggregatedOpenSql('m')})::boolean AS open,
            ${aggregatedBandSql('m')} AS band,
            array_agg(DISTINCT u.username) AS users
     FROM measurements m
     JOIN users u ON u.id = m.user_id
     GROUP BY ${key}
     ORDER BY last_seen DESC`);
  return rows;
}

function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Descarta mediciones imposibles para el usuario.
 *
 * El caso normal es un lote: la app lee el GPS una vez y sella todas las redes
 * de ese barrido con el mismo milisegundo y la misma coordenada, así que las
 * mediciones de un lote están a 0 m entre sí. El caso que hay que cubrir es el
 * otro: un cliente que manda muchas mediciones con el mismo timestamp y
 * coordenadas distintas, para quedarse con celdas de todo el mapa de un golpe.
 *
 * Con intervalo positivo se exige una velocidad plausible. Sin intervalo
 * —mismo timestamp, o uno anterior— no hay velocidad que calcular, así que se
 * exige que el punto no se haya movido. Ese margen no es teórico: en los datos
 * reales hay 1428 lotes con más de una medición en el mismo timestamp y la
 * distancia entre las mediciones de cualquiera de ellos es de 0,00 m.
 */
function antiCheat(userId, lat, lon, tsMs) {
  const prev = lastPos.get(userId);
  let allowed = true;
  if (prev) {
    const distance = haversineM(prev.lat, prev.lon, lat, lon);
    const dtS = (tsMs - prev.ts) / 1000;
    if (dtS > 0) {
      if (distance / dtS > MAX_SPEED_MPS) allowed = false;
    } else if (distance > MAX_STEP_M) {
      allowed = false;
    }
  }
  // Solo avanza la posición de referencia con una medición aceptada y con un
  // timestamp que no retrocede, así un rechazo no habilita el siguiente salto.
  if (allowed && (!prev || tsMs >= prev.ts)) {
    lastPos.set(userId, { lat, lon, ts: tsMs });
  }
  return allowed;
}

/** Texto acotado: un objeto o un array no deben llegar a una columna TEXT. */
function toText(value, maxLength) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

/** Frecuencia del canal en MHz, o null si no es un número usable. */
function toFrequency(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Momento de la medición en ms, o null si no es una fecha válida. */
function toTimestamp(value) {
  const t = new Date(value ?? Date.now()).getTime();
  return Number.isFinite(t) ? t : null;
}

// ---- Ingesta de mediciones (requiere sesión) ----
app.post('/api/measurements', requireAuth, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body
    : Array.isArray(req.body?.measurements) ? req.body.measurements : null;

  if (!list || list.length === 0) {
    return res.status(400).json({ error: 'Enviar un array de mediciones' });
  }

  // La geometría es lo indispensable: sin ella la fila no sirve, se descarta.
  const valid = list.filter(m =>
    m && m.bssid && Number.isFinite(m.latitude) && Number.isFinite(m.longitude)
        && Number.isFinite(m.rssi));

  if (valid.length === 0) {
    return res.status(400).json({ error: 'Mediciones inválidas' });
  }

  try {
    // El anti-cheat es secuencial: compara cada punto con el anterior, así que
    // se recorre la lista antes de tocar la base.
    const rowsToInsert = [];
    let dropped = 0;
    for (const m of valid) {
      // La geometría es lo indispensable y ya se validó. El resto de los
      // campos es opcional: se corrigen en vez de rechazar la fila, porque la
      // inserción es por lotes y una sola fila inválida haría fallar el lote
      // entero (y con ella las filas buenas que la rodean).
      const ts = toTimestamp(m.timestamp);
      if (ts === null) {
        dropped++;
        continue;
      }
      if (!antiCheat(req.user.id, m.latitude, m.longitude, ts)) {
        dropped++;
        continue;
      }
      rowsToInsert.push([
        req.user.id, toText(m.bssid, 32), toText(m.ssid, 64),
        m.latitude, m.longitude, Math.round(m.rssi),
        toFrequency(m.frequency), toText(m.capabilities, 255), new Date(ts),
      ]);
    }

    // Una sola sentencia por lote en vez de una por medición: la app sube de a
    // 100 por barrido y antes eso eran 100 viajes de ida y vuelta.
    const inserted = [];
    for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK) {
      const params = [];
      const tuples = rowsToInsert.slice(i, i + INSERT_CHUNK).map((row) => {
        const start = params.length;
        params.push(...row);
        return `(${row.map((_, c) => '$' + (start + c + 1)).join(',')})`;
      });
      const r = await pool.query(
        `INSERT INTO measurements
           (user_id, bssid, ssid, latitude, longitude, rssi, frequency, capabilities, ts)
         VALUES ${tuples.join(',')}
         RETURNING bssid, ssid, latitude, longitude, rssi, frequency, capabilities, ts`,
        params);
      inserted.push(...r.rows);
    }

    if (inserted.length > 0) {
      invalidateCaches();
      broadcast({ type: 'measurements', data: inserted });
    }
    res.json({ ok: true, inserted: inserted.length, dropped });
  } catch (e) {
    console.error('[api] error ingesta:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Redes agregadas (carga inicial para la web) ----
app.get('/api/networks', async (req, res) => {
  try {
    const rows = await networksCache.resolve('all', aggregateNetworks);
    res.json(rows.filter(networkPredicate(req.query)));
  } catch (e) {
    console.error('[api] error networks:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Usuarios para el filtro del mapa web ----
app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT username FROM users ORDER BY username');
    res.json(rows);
  } catch (e) {
    console.error('[api] error users:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Territorios del juego de conquista ----
app.get('/api/territories', async (_req, res) => {
  try {
    res.json(await loadTerritories());
  } catch (e) {
    console.error('[api] error territories:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Leaderboard (conquistas por jugador) ----
app.get('/api/leaderboard', async (_req, res) => {
  try {
    // Sale del mismo cálculo que /territories, que ya está cacheado.
    const territories = await loadTerritories();

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

// ---- Configuración ----
// GET público: la app Android lo descarga para aplicar intervalo/calibración.
app.get('/api/config', async (_req, res) => {
  try {
    res.json(await appConfig());
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT admin: edita la configuración del sistema.
app.put('/api/config', requireAdmin, async (req, res) => {
  try {
    const allowed = ['hex_res', 'decay_days', 'contest_threshold',
      'scan_interval_ms', 'calibration_tx', 'calibration_n'];
    const patch = {};
    for (const k of allowed) {
      if (req.body && req.body[k] !== undefined) patch[k] = req.body[k];
    }

    // Acota los valores antes de guardarlos para que el panel y la partida
    // nunca discrepen. Solo se tocan las claves presentes en el parche: si no,
    // guardar el intervalo de escaneo reiniciaría la resolución de la partida.
    const clamped = territoryOptions(patch);
    const bounds = [
      ['hex_res', clamped.hexRes],
      ['decay_days', clamped.decayDays],
      ['contest_threshold', clamped.contestThreshold],
    ];
    for (const [key, value] of bounds) {
      if (key in patch) patch[key] = value;
    }
    if ('scan_interval_ms' in patch) {
      const ms = Number(patch.scan_interval_ms);
      patch.scan_interval_ms = Number.isFinite(ms)
        ? Math.min(60000, Math.max(1000, Math.round(ms))) : 6000;
    }

    if (Object.keys(patch).length) {
      await updateSettings(patch);
      // Un cambio de hex_res, decaimiento o umbral recalcula los donos.
      territoriesCache.invalidate();
      settingsCache.invalidate();
    }
    res.json(await appConfig());
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ---- Panel de administración ----

// Estadísticas del sistema
app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*)::int n FROM users');
    const meas = await pool.query('SELECT COUNT(*)::int n FROM measurements');
    const territories = await loadTerritories();
    res.json({
      users: users.rows[0].n,
      measurements: meas.rows[0].n,
      territories: territories.length,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Lista de usuarios
app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, role, created_at FROM users ORDER BY id`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Crear usuario (admin)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const role = ['admin', 'user'].includes(req.body?.role) ? req.body.role : 'user';
    const user = await createUser(req.body?.username, req.body?.password, role);
    res.status(201).json(user);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Editar rol y/o contraseña de un usuario
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    if (req.body?.role !== undefined) {
      if (!['admin', 'user'].includes(req.body.role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      await setUserRole(req.params.id, req.body.role);
    }
    if (req.body?.password !== undefined) {
      await setUserPassword(req.params.id, req.body.password);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Borrar un usuario (y sus datos en cascada)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Mediciones: listar (paginado + filtros) y borrar
app.get('/api/admin/measurements', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const cond = [];
    const params = [];
    const push = (sql, v) => { params.push(v); cond.push(sql); };

    if (req.query.user) { params.push(req.query.user); cond.push('u.username = $' + params.length); }
    if (req.query.from) { params.push(req.query.from); cond.push('m.ts >= $' + params.length); }
    if (req.query.to) { params.push(req.query.to); cond.push('m.ts <= $' + params.length); }
    if (req.query.q) { params.push('%' + req.query.q + '%'); cond.push('m.ssid ILIKE $' + params.length); }
    if (req.query.mac) { params.push('%' + req.query.mac + '%'); cond.push('m.bssid ILIKE $' + params.length); }

    // Filtros combinados: tipo de seguridad, banda y señal mínima.
    // Acá se listan mediciones individuales, así que los filtros van por fila.
    const filters = rowFilters(req.query, { alias: 'm', paramOffset: params.length });
    cond.push(...filters.where);
    params.push(...filters.params);

    const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';

    // Ordenamiento: whitelist de columnas para evitar inyección SQL.
    const SORT = { id: 'm.id', username: 'u.username', bssid: 'm.bssid',
      ssid: 'm.ssid', rssi: 'm.rssi', ts: 'm.ts' };
    const sortCol = SORT[req.query.sort] || 'm.ts';
    const dir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    params.push(limit, offset);
    const pageSql = `SELECT m.id, u.username, m.bssid, m.ssid, m.latitude, m.longitude,
                        m.rssi, m.frequency, m.capabilities, m.ts
                     FROM measurements m JOIN users u ON u.id = m.user_id
                     ${where} ORDER BY ${sortCol} ${dir}, m.id ${dir} LIMIT $${params.length - 1}
                     OFFSET $${params.length}`;
    const cntSql = `SELECT COUNT(*)::int n
                    FROM measurements m JOIN users u ON u.id = m.user_id ${where}`;

    const [rows, cnt] = await Promise.all([pool.query(pageSql, params), pool.query(cntSql, params.slice(0, params.length - 2))]);
    res.json({ total: cnt.rows[0].n, offset, limit, rows: rows.rows });
  } catch (e) {
    console.error('[api] error mediciones admin:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/admin/measurements', requireAdmin, async (_req, res) => {
  try {
    await pool.query('DELETE FROM measurements');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Configuración del juego (leer/editar)
app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

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
