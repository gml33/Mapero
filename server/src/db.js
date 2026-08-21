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
  ts          TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurements_ts ON measurements (ts);
CREATE INDEX IF NOT EXISTS idx_measurements_ssid ON measurements (ssid);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
`;

export async function initDb() {
  await pool.query(SCHEMA);
  console.log('[db] esquema listo');
}
