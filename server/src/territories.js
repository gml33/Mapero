import { latLngToCell, cellToLatLng } from 'h3-js';

/** Resolución H3 → hexágonos de ~150 m. */
export const HEX_RES = 10;
/** Constante de decaimiento: la cobertura antigua pierde valor (~7 días). */
const TAU_MS = 7 * 24 * 3600 * 1000;

/**
 * Calcula el dueño de cada hexágono a partir de las mediciones.
 * Regla "cobertura + decaimiento": por celda, cada medición suma un peso que
 * decae exponencialmente con su antigüedad; el dueño es el dispositivo con más
 * peso acumulado (empates se resuelven por actividad más reciente).
 *
 * rows: [{ device_id, name, latitude, longitude, ts }]
 */
export function buildTerritories(rows, now = Date.now()) {
  const score = new Map(); // `${hex}|${deviceId}` -> acc

  for (const r of rows) {
    const hex = latLngToCell(r.latitude, r.longitude, HEX_RES);
    const age = now - new Date(r.ts).getTime();
    const w = Math.exp(-age / TAU_MS);
    const key = hex + '|' + r.device_id;
    const acc = score.get(key) || {
      hex, deviceId: r.device_id, name: r.name, score: 0, count: 0, lastTs: 0,
    };
    acc.score += w;
    acc.count++;
    const t = new Date(r.ts).getTime();
    if (t > acc.lastTs) acc.lastTs = t;
    score.set(key, acc);
  }

  // Por hexágono, elegir el dispositivo con mayor score.
  const byHex = new Map();
  for (const v of score.values()) {
    const cur = byHex.get(v.hex);
    if (!cur || v.score > cur.score
        || (v.score === cur.score && v.lastTs > cur.lastTs)) {
      byHex.set(v.hex, v);
    }
  }

  return [...byHex.values()].map((v) => {
    const [lat, lon] = cellToLatLng(v.hex);
    return {
      hex: v.hex,
      latitude: lat,
      longitude: lon,
      owner: v.name,
      score: Math.round(v.score * 100) / 100,
      count: v.count,
    };
  });
}
