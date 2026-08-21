import { pool } from './db.js';

/** Lee todas las claves de configuración como un objeto simple. */
export async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Actualiza claves dadas por { key: value }. */
export async function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]);
  }
}

/** Configuración que las apps Android descargan. */
export async function appConfig() {
  const s = await getSettings();
  return {
    scanIntervalMs: Number(s.scan_interval_ms) || 6000,
    calibration: {
      txPower: Number(s.calibration_tx) || -45,
      pathLossN: Number(s.calibration_n) || 2.0,
    },
    territory: {
      hexRes: Number(s.hex_res) || 10,
      decayDays: Number(s.decay_days) || 7,
      contestThreshold: Number(s.contest_threshold) || 0.6,
    },
  };
}
