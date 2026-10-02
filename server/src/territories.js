import { latLngToCell, cellToLatLng, cellToBoundary } from 'h3-js';

/** Resolución H3 → hexágonos de ~150 m. */
export const HEX_RES = 10;
/** Decaimiento de la cobertura por defecto (~7 días). */
export const DECAY_DAYS = 7;
/** Umbral para marcar una celda "en disputa". */
export const CONTEST_THRESHOLD = 0.6;

/**
 * Ajusta un número al rango permitido y lo devuelve, o `fallback` si no es un
 * número usable.
 *
 * Solo acepta números y cadenas numéricas no vacías a propósito: `Number()`
 * convierte null, '', [], false y true en 0 o 1, que son valores válidos como
 * número. Sin este filtro, un campo vacío en el panel acababa guardado como 0
 * y cambiaba la resolución de toda la partida a celdas enormes.
 */
function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Ajustes de la partida desde `settings`, ya validados y acotados.
 * `hex_res` admite 0..15 (límite de H3); un hex_res distinto recalcula los
 * donos de todas las celdas, así que la partida muestra un mapa nuevo.
 */
export function territoryOptions(settings = {}) {
  return {
    hexRes: Math.round(clampNumber(settings.hex_res, 0, 15, HEX_RES)),
    decayDays: clampNumber(settings.decay_days, 0.1, 365, DECAY_DAYS),
    contestThreshold: clampNumber(
      settings.contest_threshold, 0, 1, CONTEST_THRESHOLD),
  };
}

/**
 * Calcula el dueño de cada hexágono a partir de las mediciones.
 * Regla "cobertura + decaimiento": por celda, cada medición suma un peso que
 * decae exponencialmente con su antigüedad; el dueño es el dispositivo con más
 * peso acumulado (empates se resuelven por actividad más reciente).
 *
 * rows: [{ user_id, name, latitude, longitude, ts }]
 * opts: { hexRes, decayDays, contestThreshold } — ver `territoryOptions`.
 */
export function buildTerritories(rows, opts = {}, now = Date.now()) {
  const hexRes = opts.hexRes ?? HEX_RES;
  const tauMs = (opts.decayDays ?? DECAY_DAYS) * 24 * 3600 * 1000;
  const threshold = opts.contestThreshold ?? CONTEST_THRESHOLD;

  const score = new Map(); // `${hex}|${userId}` -> acc

  for (const r of rows) {
    const hex = latLngToCell(r.latitude, r.longitude, hexRes);
    const age = now - new Date(r.ts).getTime();
    const w = Math.exp(-age / tauMs);
    const key = hex + '|' + r.user_id;
    const acc = score.get(key) || {
      hex, userId: r.user_id, name: r.name, score: 0, count: 0, lastTs: 0,
    };
    acc.score += w;
    acc.count++;
    const t = new Date(r.ts).getTime();
    if (t > acc.lastTs) acc.lastTs = t;
    score.set(key, acc);
  }

  // Por hexágono, reunir todos los jugadores y quedarnos con los 2 mejores.
  const byHex = new Map();
  for (const v of score.values()) {
    if (!byHex.has(v.hex)) byHex.set(v.hex, []);
    byHex.get(v.hex).push(v);
  }

  return [...byHex.values()].map((list) => {
    list.sort((a, b) => b.score - a.score || b.lastTs - a.lastTs);
    const top = list[0];
    const second = list[1];
    const [lat, lon] = cellToLatLng(top.hex);
    const boundary = cellToBoundary(top.hex, true).map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));
    // "En disputa": el segundo tiene al menos el umbral de la cobertura del dueño.
    const contested = !!second && second.score >= threshold * top.score;
    return {
      hex: top.hex,
      latitude: lat,
      longitude: lon,
      boundary,
      owner: top.name,
      score: Math.round(top.score * 100) / 100,
      secondScore: second ? Math.round(second.score * 100) / 100 : 0,
      contested,
      count: top.count,
    };
  });
}
