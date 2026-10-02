import { test } from 'node:test';
import assert from 'node:assert/strict';

import { territoryOptions, buildTerritories } from '../src/territories.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const BAU = { hexRes: 10, decayDays: 7, contestThreshold: 0.6 };

/** Fila de medición con `min` minutos de antigüedad respecto a `now`. */
function row(userId, name, lat, lon, minutesAgo) {
  return {
    user_id: userId,
    name,
    latitude: lat,
    longitude: lon,
    ts: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
  };
}

test('territoryOptions: usa los valores por defecto si no hay nada guardado', () => {
  assert.deepEqual(territoryOptions({}), BAU);
});

test('territoryOptions: acota cada valor a su rango', () => {
  assert.equal(territoryOptions({ hex_res: 99 }).hexRes, 15, 'hex_res alto');
  assert.equal(territoryOptions({ hex_res: -4 }).hexRes, 0, 'hex_res bajo');
  assert.equal(territoryOptions({ decay_days: -5 }).decayDays, 0.1, 'decay_days negativo');
  assert.equal(territoryOptions({ decay_days: 0 }).decayDays, 0.1, 'decay_days en cero');
  assert.equal(territoryOptions({ decay_days: 5000 }).decayDays, 365, 'decay_days enorme');
  assert.equal(territoryOptions({ contest_threshold: -1 }).contestThreshold, 0, 'umbral bajo');
  assert.equal(territoryOptions({ contest_threshold: 50 }).contestThreshold, 1, 'umbral alto');
});

test('territoryOptions: hex_res = 0 es válido, no se confunde con "sin valor"', () => {
  // El bug: `Number(s.hex_res) || 10` convertía 0 en 10.
  assert.equal(territoryOptions({ hex_res: 0 }).hexRes, 0);
  assert.equal(territoryOptions({ hex_res: '0' }).hexRes, 0);
});

test('territoryOptions: lo vacío y lo no numérico vuelven al default, no al mínimo', () => {
  // Number() convierte null, '', [], false y true en 0 o 1, que son números
  // válidos. Un campo vacío en el panel tiene que salir como "sin valor".
  for (const bad of ['abc', null, undefined, '', '   ', NaN, [], {}, true, false]) {
    assert.deepEqual(territoryOptions({ hex_res: bad, decay_days: bad, contest_threshold: bad }),
      BAU, `valor ${JSON.stringify(bad)}`);
  }
});

test('territoryOptions: acepta los valores por rango en string (vienen de TEXT)', () => {
  const o = territoryOptions({ hex_res: '12', decay_days: '3.5', contest_threshold: '0.25' });
  assert.deepEqual(o, { hexRes: 12, decayDays: 3.5, contestThreshold: 0.25 });
});

test('buildTerritories: sin filas no hay celdas', () => {
  assert.deepEqual(buildTerritories([], BAU), []);
});

test('buildTerritories: el dueño es quien más cobertura acumula', () => {
  const now = Date.now();
  const rows = [
    { user_id: 1, name: 'ana', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
    { user_id: 2, name: 'beto', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
    { user_id: 1, name: 'ana', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
  ];
  const [t] = buildTerritories(rows, BAU, now);
  assert.equal(t.owner, 'ana');
  assert.equal(t.count, 2);
});

test('buildTerritories: el decaimiento hace que lo viejo pese menos', () => {
  const now = Date.now();
  const rows = [
    // 10 mediciones de hace 20 días: peso 10 * exp(-20/7) ≈ 1.4
    ...Array.from({ length: 10 }, () => ({
      user_id: 1, name: 'viejo', latitude: -34.6, longitude: -58.4,
      ts: new Date(now - 20 * DAY).toISOString(),
    })),
    // 3 mediciones de ahora: peso 3
    ...Array.from({ length: 3 }, () => ({
      user_id: 2, name: 'nuevo', latitude: -34.6, longitude: -58.4,
      ts: new Date(now).toISOString(),
    })),
  ];
  const [t] = buildTerritories(rows, BAU, now);
  assert.equal(t.owner, 'nuevo', 'lo reciente tiene que ganarle a lo viejo');
  assert.equal(t.secondScore > 0, true);
});

test('buildTerritories: la cobertura decae con el tiempo', () => {
  const now = Date.now();
  const fresh = buildTerritories([row(1, 'a', -34.6, -58.4, 0)], BAU, now)[0].score;
  // row() toma minutos: 60 días son 60 * 24 * 60.
  const old = buildTerritories([row(1, 'a', -34.6, -58.4, 60 * 24 * 60)], BAU, now)[0].score;
  assert.ok(fresh > old, `reciente (${fresh}) > viejo (${old})`);
  assert.equal(old, 0, 'a 60 días con decaimiento de 7 el peso redondea a 0');
});

test('buildTerritories: contested solo con segundo lugar y según el umbral', () => {
  const now = Date.now();
  const rows = [
    { user_id: 1, name: 'ana', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
    { user_id: 2, name: 'beto', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
  ];
  // 1 contra 1: el segundo tiene el 100% del dueño.
  assert.equal(buildTerritories(rows, BAU, now)[0].contested, true, 'empate va a disputa');
  assert.equal(
    buildTerritories(rows, { ...BAU, contestThreshold: 1.5 }, now)[0].contested,
    false, 'con umbral 1.5 nadie queda en disputa');
  // Un solo jugador no tiene segundo, así que nunca hay disputa.
  assert.equal(
    buildTerritories([rows[0]], BAU, now)[0].contested, false,
    'sin segundo no hay disputa');
});

test('buildTerritories: hexRes cambia el tamaño de las celdas', () => {
  const now = Date.now();
  // Dos puntos a ~440 m: en res 10 (celdas de ~150 m) no comparten celda; en
  // res 8 (celdas de ~1,2 km) sí.
  const rows = [
    { user_id: 1, name: 'a', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
    { user_id: 2, name: 'b', latitude: -34.596, longitude: -58.4, ts: new Date(now).toISOString() },
  ];
  assert.equal(buildTerritories(rows, { ...BAU, hexRes: 10 }, now).length, 2);
  assert.equal(buildTerritories(rows, { ...BAU, hexRes: 8 }, now).length, 1);
});

test('buildTerritories: decayDays del ajuste se aplica de verdad', () => {
  const now = Date.now();
  const rows = [
    ...Array.from({ length: 10 }, () => ({
      user_id: 1, name: 'a', latitude: -34.6, longitude: -58.4,
      ts: new Date(now - 20 * DAY).toISOString(),
    })),
    { user_id: 2, name: 'b', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
  ];
  // Con 7 días lo viejo vale casi nada y gana 'b'; con 200 días, 'a'.
  assert.equal(buildTerritories(rows, { ...BAU, decayDays: 7 }, now)[0].owner, 'b');
  assert.equal(buildTerritories(rows, { ...BAU, decayDays: 200 }, now)[0].owner, 'a');
});

test('buildTerritories: devuelve el boundary del hexágono', () => {
  const now = Date.now();
  const [t] = buildTerritories([row(1, 'a', -34.6, -58.4, 0)], BAU, now);
  assert.ok(Array.isArray(t.boundary), 'boundary es un array');
  assert.ok(t.boundary.length >= 6, `un hexágono tiene al menos 6 vértices, tiene ${t.boundary.length}`);
  for (const p of t.boundary) {
    assert.equal(typeof p.latitude, 'number');
    assert.equal(typeof p.longitude, 'number');
    assert.ok(Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180,
      `vértice en rango: ${p.latitude},${p.longitude}`);
  }
  // El centro cae dentro del polígono (con el radio del hexágono como margen).
  for (const p of t.boundary) {
    assert.ok(Math.abs(p.latitude - t.latitude) < 0.01, 'el centro está cerca del borde');
  }
});

test('buildTerritories: score y secondScore vienen redondeados', () => {
  const now = Date.now();
  const [t] = buildTerritories([row(1, 'a', -34.6, -58.4, 0)], BAU, now);
  assert.equal(t.score, Math.round(t.score * 100) / 100);
  assert.equal(t.secondScore, 0, 'sin segundo lugar el score es 0');
});

test('buildTerritories: sin argumentos opcionales usa los valores por defecto', () => {
  const now = Date.now();
  const [t] = buildTerritories([row(1, 'a', -34.6, -58.4, 0)], {}, now);
  assert.equal(t.owner, 'a');
  assert.ok(t.boundary.length >= 6);
});

test('buildTerritories: usuarios distintos en el mismo hexágono no se pisan', () => {
  const now = Date.now();
  const rows = [
    { user_id: 1, name: 'ana', latitude: -34.6, longitude: -58.4, ts: new Date(now).toISOString() },
    { user_id: 2, name: 'beto', latitude: -34.600001, longitude: -58.400001, ts: new Date(now).toISOString() },
  ];
  const out = buildTerritories(rows, BAU, now);
  assert.equal(out.length, 1, 'una sola celda');
  assert.equal(out[0].secondScore > 0, true, 'el segundo existe');
});
