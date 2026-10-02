import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE TABLE IF NOT EXISTS measurements (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bssid       TEXT NOT NULL,
  ssid        TEXT NOT NULL DEFAULT '',
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  rssi        INTEGER NOT NULL,
  frequency   INTEGER,
  capabilities TEXT,
  ts          TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurements_ts ON measurements (ts);
CREATE INDEX IF NOT EXISTS idx_measurements_ssid ON measurements (ssid);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- Configuración del sistema (clave -> valor)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const DEFAULTS = {
  hex_res: '10',              // resolución H3 de los territorios (~150 m)
  decay_days: '7',            // decaimiento de la cobertura
  contest_threshold: '0.6',   // umbral para marcar una celda "en disputa"
  scan_interval_ms: '6000',   // intervalo de escaneo de la app (ms)
  calibration_tx: '-45',      // señal a 1 m (dBm)
  calibration_n: '2.0',       // exponente de pérdida
};

export async function initDb() {
  await pool.query(SCHEMA);
  // Asegura la columna de rol en usuarios ya existentes.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
  // Asegura la columna de capabilities en mediciones ya existentes.
  await pool.query(`ALTER TABLE measurements ADD COLUMN IF NOT EXISTS capabilities TEXT`);
  // Asegura la expiración en sesiones ya existentes: sin esto, requireAuth
  // filtraría las filas viejas y nadie podría iniciar sesión otra vez.
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at
                    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')`);
  // Sesiones vencidas.
  await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  // Siembra los valores por defecto de configuración.
  for (const [k, v] of Object.entries(DEFAULTS)) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [k, v]);
  }
  await promoteAdmin();
  console.log('[db] esquema listo');
}

/**
 * Primer administrador definido por variable de entorno.
 *
 * Solo promueve si el sistema todavía no tiene ningún admin. Promover en cada
 * arranque sin esa condición abría la puerta a que cualquiera que se registrara
 * con ese nombre quedara como admin en el reinicio siguiente.
 */
async function promoteAdmin() {
  const adminUser = process.env.ADMIN_USER;
  if (!adminUser) return;

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int n FROM users WHERE role = 'admin'`);
  if (rows[0].n > 0) {
    console.log(`[db] ADMIN_USER=${adminUser} ignorado: ya hay ${rows[0].n} admin(s)`);
    return;
  }
  const r = await pool.query(
    `UPDATE users SET role = 'admin' WHERE username = $1 RETURNING id`, [adminUser]);
  if (r.rowCount > 0) {
    console.log(`[db] ADMIN_USER=${adminUser} promovido a admin`);
  } else {
    console.warn(`[db] ADMIN_USER=${adminUser} no existe: regístrate con ese usuario primero`);
  }
}
