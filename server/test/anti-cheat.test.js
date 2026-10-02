import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AntiCheat, haversineM } from '../src/anti-cheat.js';

/** 1e-5 grados de latitud ≈ 1,11 m. */
const M = 1e-5;
const B = 1789005000000;
const LAT = -34.6000;
const LON = -58.4000;

// Anti-cheat limpio: cada test arranca sin posiciones recordadas.
const nuevo = (opts) => new AntiCheat(opts);

/** Distancia desde el punto de referencia. */
const metros = (lat, lon) => haversineM(LAT, LON, lat, lon);

// ---------------------------------------------------------------- tráfico legítimo
test('haversine: cero en el mismo punto', () => {
  assert.equal(haversineM(LAT, LON, LAT, LON), 0);
});

test('haversine: ~111 m por 0.001 grado de latitud', () => {
  const d = haversineM(0, 0, 0.001, 0);
  assert.ok(Math.abs(d - 111.2) < 1, `esperaba ~111 m, dio ${d.toFixed(1)}`);
});

test('haversine: la longitud se acorta con la latitud', () => {
  const enEcuador = haversineM(0, 0, 0, 0.001);
  const enArgentina = haversineM(LAT, LON, LAT, LON + 0.001);
  assert.ok(enArgentina < enEcuador,
    `a 34° de latitud un grado de longitud es más corto: ${enArgentina.toFixed(0)} < ${enEcuador.toFixed(0)}`);
});

// ------------------------------------------------------------------ tráfico legítimo
test('lote de 12 redes con el mismo timestamp y coordenada: todas pasan', () => {
  const ac = nuevo();
  for (let i = 0; i < 12; i++) assert.equal(ac.accepts(1, LAT, LON, B), true);
});

test('lote con timestamps 1 ms de diferencia: todas pasan', () => {
  // Es el caso real: WifiScanner sella cada red del lote con currentTimeMillis().
  const ac = nuevo();
  assert.equal(ac.accepts(1, LAT, LON, B), true);
  assert.equal(ac.accepts(1, LAT, LON, B + 1), true);
});

test('caminata de 1,2 m/s', () => {
  const ac = nuevo();
  assert.equal(ac.accepts(1, LAT, LON, B), true);
  assert.equal(ac.accepts(1, LAT + 6 * M, LON, B + 5000), true);
});

test('carrera de 4 m/s', () => {
  const ac = nuevo();
  assert.equal(ac.accepts(1, LAT, LON, B), true);
  assert.equal(ac.accepts(1, LAT + 20 * M, LON, B + 5000), true);
});

test('bici de 20 m/s', () => {
  const ac = nuevo();
  assert.equal(ac.accepts(1, LAT, LON, B), true);
  assert.equal(ac.accepts(1, LAT + 90 * M, LON, B + 5000), true);
});

test('el límite está donde corresponde: por debajo y por encima', () => {
  // 40 m/s durante 4 s es el tope. Se prueban 150 m (37,5 m/s) y 200 m
  // (50 m/s) en vez de los 160 exactos, porque comparar contra el borde con
  // punto flotante es frágil: 1e-5 grados son 1,11194 m, no 1,11.
  const M_POR_GRADO = 1.11194;
  const grados = (metros) => (metros / M_POR_GRADO) * M;

  const debajo = nuevo({ maxSpeedMps: 40 });
  debajo.accepts(1, LAT, LON, B);
  assert.equal(debajo.accepts(1, LAT + grados(150), LON, B + 4000), true, '150 m en 4 s son 37,5 m/s');

  const encima = nuevo({ maxSpeedMps: 40 });
  encima.accepts(1, LAT, LON, B);
  assert.equal(encima.accepts(1, LAT + grados(200), LON, B + 4000), false, '200 m en 4 s son 50 m/s');
});


// ---------------------------------------------------------------------- ataques
test('teletransporte de 500 km en 1 s', () => {
  const ac = nuevo();
  assert.equal(ac.accepts(1, LAT, LON, B), true);
  assert.equal(ac.accepts(1, -39.0, -53.0, B + 1000), false);
});

test('salto de 300 m en 5 s (60 m/s)', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  assert.equal(ac.accepts(1, LAT + 270 * M, LON, B + 5000), false);
});

test('ATAQUE: 39 coordenadas con el mismo timestamp', () => {
  // La forma real del ataque: un solo lote, un solo timestamp, muchas
  // coordenadas. Solo sobrevive la que está a menos de maxStepM.
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  let aceptadas = 0;
  for (let i = 1; i < 40; i++) {
    if (ac.accepts(1, LAT + i * 40 * M, LON + i * 40 * M, B)) aceptadas++;
  }
  assert.equal(aceptadas, 0, 'ninguna de las 39 posiciones lejanas entra');
});

test('timestamp que retrocede con salto', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  assert.equal(ac.accepts(1, -40.0, -50.0, B - 20000), false);
});

test('el rechazo no habilita el siguiente salto', () => {
  // Si el rechazo moviera la referencia, el atacante podría intentar de nuevo
  // desde la posición lejana.
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  assert.equal(ac.accepts(1, -40.0, -50.0, B + 1000), false);
  assert.equal(ac.accepts(1, -40.0, -50.0, B + 2000), false, 'sigue rechazando');
  assert.equal(ac.accepts(1, LAT + 5 * M, LON, B + 3000), true,
    'desde la posición real sigue pudiendo caminar');
});

// -------------------------------------------------- sin intervalo con que calcular
test('mismo timestamp con salto dentro del margen: pasa', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  const a = metros(LAT + 18 * M, LON);
  assert.ok(a < 30, `la primera distancia era ${a.toFixed(1)} m, tiene que entrar en el margen`);
  assert.equal(ac.accepts(1, LAT + 18 * M, LON, B), true);
});

test('mismo timestamp con salto fuera del margen: se descarta', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  assert.equal(ac.accepts(1, LAT + 180 * M, LON, B), false);
});

test('el margen sin intervalo es configurable', () => {
  const laxo = nuevo({ maxStepM: 500 });
  laxo.accepts(1, LAT, LON, B);
  assert.equal(laxo.accepts(1, LAT + 180 * M, LON, B), true, 'con margen de 500 m entra');

  const estricto = nuevo({ maxStepM: 5 });
  estricto.accepts(1, LAT, LON, B);
  assert.equal(estricto.accepts(1, LAT + 18 * M, LON, B), false, 'con margen de 5 m no');
});

// ------------------------------------------------------------------ por usuario
test('los usuarios no se pisan entre sí', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  // El usuario 2 va a otro lado del mundo: es su primer punto, así que entra.
  assert.equal(ac.accepts(2, -39.0, -53.0, B), true);
  assert.equal(ac.size, 2);
});

test('un rechazo de un usuario no afecta a otro', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  assert.equal(ac.accepts(1, -40.0, -50.0, B + 1000), false);
  assert.equal(ac.accepts(2, LAT, LON, B), true);
});

// -------------------------------------------------------------------- memoria
test('el tope de usuarios descarta el más antiguo', () => {
  const ac = nuevo({ maxTrackedUsers: 3 });
  ac.accepts(1, LAT, LON, B);
  ac.accepts(2, LAT, LON, B);
  ac.accepts(3, LAT, LON, B);
  assert.equal(ac.size, 3);

  ac.accepts(4, LAT, LON, B);
  assert.equal(ac.size, 3, 'no crece más allá del tope');
  // El 1 fue el primero, así que es el que se fue.
  assert.equal(ac.accepts(1, LAT, LON, B + 1000), true,
    'al usuario olvidado se lo acepta como si fuera el primero de nuevo');
});

test('un usuario ya conocido no displace a otro al llegar al tope', () => {
  const ac = nuevo({ maxTrackedUsers: 2 });
  ac.accepts(1, LAT, LON, B);
  ac.accepts(2, LAT, LON, B);
  ac.accepts(1, LAT + 2 * M, LON, B + 2000);
  assert.equal(ac.size, 2);
  assert.equal(ac.accepts(2, LAT + 2 * M, LON, B + 2000), true,
    'el usuario 2 sigue teniendo su referencia');
});

test('forgetOlderThan saca las posiciones viejas', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  ac.accepts(2, LAT, LON, B + 10000);
  assert.equal(ac.size, 2);

  ac.forgetOlderThan(B + 5000);
  assert.equal(ac.size, 1, 'solo se va el más viejo');
  // El que quedó conserva su referencia.
  assert.equal(ac.accepts(2, LAT + 400 * M, LON, B + 11000), false);
});

test('forgetOlderThan no saca nada si nada venció', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  ac.forgetOlderThan(B - 100000);
  assert.equal(ac.size, 1);
});

test('forgetOlderThan con todo viejo vacía el registro', () => {
  const ac = nuevo();
  ac.accepts(1, LAT, LON, B);
  ac.accepts(2, LAT, LON, B);
  ac.forgetOlderThan(B + 1);
  assert.equal(ac.size, 0);
  // Vaciado, el usuario vuelve a aceptarse como primer punto.
  assert.equal(ac.accepts(1, -40.0, -50.0, B + 1), true);
});