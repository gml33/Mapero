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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
  // Siembra los valores por defecto de configuración.
  for (const [k, v] of Object.entries(DEFAULTS)) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [k, v]);
  }
  // Primer administrador definido por variable de entorno.
  const adminUser = process.env.ADMIN_USER;
  if (adminUser) {
    await pool.query(`UPDATE users SET role = 'admin' WHERE username = $1`, [adminUser]);
  }
  console.log('[db] esquema listo');
}
