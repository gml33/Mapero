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
 * rows: [{ user_id, name, latitude, longitude, ts }]
 */
export function buildTerritories(rows, now = Date.now()) {
  const score = new Map(); // `${hex}|${userId}` -> acc

  for (const r of rows) {
    const hex = latLngToCell(r.latitude, r.longitude, HEX_RES);
    const age = now - new Date(r.ts).getTime();
    const w = Math.exp(-age / TAU_MS);
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
    // "En disputa": el segundo tiene al menos 60% de la cobertura del dueño.
    const contested = !!second && second.score >= 0.6 * top.score;
    return {
      hex: top.hex,
      latitude: lat,
      longitude: lon,
      owner: top.name,
      score: Math.round(top.score * 100) / 100,
      secondScore: second ? Math.round(second.score * 100) / 100 : 0,
      contested,
      count: top.count,
    };
  });
}
