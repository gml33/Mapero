import { test } from 'node:test';
import assert from 'node:assert/strict';

import { networkPredicate, rowFilters, aggregatedOpenSql, aggregatedBandSql, bandSql, signalWeightSql } from '../src/filters.js';

/** Red agregada tal como la devuelve /api/networks. */
function net(over = {}) {
  return {
    name: 'MiRed', latitude: -34.6, longitude: -58.4, rssi: -65,
    samples: 10, last_seen: '2026-09-01T00:00:00Z',
    open: true, band: '2.4', users: ['ana', 'beto'], ...over,
  };
}

const names = (query, list) => list.filter(networkPredicate(query)).map((n) => n.name);

test('networkPredicate: sin filtros deja pasar todo', () => {
  const list = [net(), net({ name: 'Otra' })];
  assert.deepEqual(names({}, list), ['MiRed', 'Otra']);
});

test('networkPredicate: type distingue abierto, protegido y sin datos', () => {
  const list = [
    net({ name: 'Abierta', open: true }),
    net({ name: 'Protegida', open: false }),
    net({ name: 'SinDatos', open: null }),
  ];
  assert.deepEqual(names({ type: 'open' }, list), ['Abierta']);
  assert.deepEqual(names({ type: 'protected' }, list), ['Protegida']);
  assert.deepEqual(names({ type: 'unknown' }, list), ['SinDatos']);
});

test('networkPredicate: los tres estados de seguridad son disjuntos y completos', () => {
  // El bug: `if (type==='open' && n.open !== true)` con open numérico 0/1 dejaba
  // el filtro vacío, y `!n.open` metía las redes sin datos en "protegidas".
  const list = [net({ open: true }), net({ open: false }), net({ open: null })];
  const open = list.filter(networkPredicate({ type: 'open' })).length;
  const prot = list.filter(networkPredicate({ type: 'protected' })).length;
  const unk = list.filter(networkPredicate({ type: 'unknown' })).length;
  assert.equal(open, 1);
  assert.equal(prot, 1);
  assert.equal(unk, 1);
  assert.equal(open + prot + unk, list.length, 'nada queda sin clasificar');
});

test('networkPredicate: un valor de type desconocido no filtra nada', () => {
  const list = [net({ open: true }), net({ open: false })];
  assert.equal(list.filter(networkPredicate({ type: 'inventado' })).length, 2);
});

test('networkPredicate: band filtra por la banda agregada', () => {
  const list = [net({ name: 'a', band: '2.4' }), net({ name: 'b', band: '5' }),
    net({ name: 'c', band: '6' }), net({ name: 'd', band: null })];
  assert.deepEqual(names({ band: '2.4' }, list), ['a']);
  assert.deepEqual(names({ band: '5' }, list), ['b']);
  assert.deepEqual(names({ band: '6' }, list), ['c']);
  assert.deepEqual(names({ band: '9' }, list), ['a', 'b', 'c', 'd'], 'banda inexistente');
});

test('networkPredicate: sig compara contra el promedio de la red', () => {
  const list = [net({ name: 'fuerte', rssi: -55 }), net({ name: 'medio', rssi: -72 }),
    net({ name: 'debil', rssi: -90 })];
  assert.deepEqual(names({ sig: -70 }, list), ['fuerte'], '-72 es más débil que -70');
  assert.deepEqual(names({ sig: -80 }, list), ['fuerte', 'medio']);
  assert.deepEqual(names({ sig: -95 }, list), ['fuerte', 'medio', 'debil']);
  // sig=0 significa "0 dBm o más": ninguna red WiFi llega, así que vacío es lo
  // correcto. No es lo mismo que no filtrar.
  assert.deepEqual(names({ sig: 0 }, list), []);
});

test('networkPredicate: sig inválido o vacío no filtra', () => {
  const list = [net({ rssi: -55 }), net({ rssi: -95 })];
  // null y '' valen 0 para Number(), y sig=0 no deja pasar ninguna red.
  for (const bad of ['abc', '', '   ', undefined, null, NaN, 'NaN', 1e999, [], {}]) {
    assert.equal(list.filter(networkPredicate({ sig: bad })).length, 2,
      `sig=${JSON.stringify(bad)}`);
  }
});

test('networkPredicate: user busca en la lista de usuarios de la red', () => {
  const list = [net({ name: 'a', users: ['ana'] }), net({ name: 'b', users: ['ana', 'beto'] }),
    net({ name: 'c', users: [] }), net({ name: 'd', users: undefined })];
  assert.deepEqual(names({ user: 'ana' }, list), ['a', 'b']);
  assert.deepEqual(names({ user: 'beto' }, list), ['b']);
  assert.deepEqual(names({ user: 'fantasma' }, list), []);
});

test('networkPredicate: q no distingue mayúsculas', () => {
  const list = [net({ name: 'Fibertel WiFi900' }), net({ name: 'ClaroFibra' })]
  assert.deepEqual(names({ q: 'fibertel' }, list), ['Fibertel WiFi900']);
  assert.deepEqual(names({ q: 'FIBER' }, list), ['Fibertel WiFi900']);
  assert.deepEqual(names({ q: 'l Wi' }, list), ['Fibertel WiFi900'], 'coincidencia parcial');
  assert.deepEqual(names({ q: 'o Fi' }, list), [], 'no hay "o fi" en el nombre');
});

test('networkPredicate: los filtros se combinan con AND', () => {
  const list = [
    net({ name: 'a', open: false, band: '5', rssi: -60 }),
    net({ name: 'b', open: false, band: '2.4', rssi: -60 }),
    net({ name: 'c', open: true, band: '5', rssi: -60 }),
    net({ name: 'd', open: false, band: '5', rssi: -90 }),
  ];
  assert.deepEqual(names({ type: 'protected', band: '5', sig: -70 }, list), ['a']);
});

test('rowFilters: sin filtros no agrega condiciones', () => {
  assert.deepEqual(rowFilters({}), { where: [], params: [] });
});

test('rowFilters: type filtra por fila y unknown usa el negativo', () => {
  assert.deepEqual(rowFilters({ type: 'open' }).where.length, 1);
  assert.equal(rowFilters({ type: 'unknown' }).where[0].startsWith('NOT '), true);
  assert.deepEqual(rowFilters({ type: 'inventado' }), { where: [], params: [] });
});

test('rowFilters: sig se parametriza con el offset que le pasa el llamador', () => {
  const base = rowFilters({ sig: -70 });
  assert.deepEqual(base.params, [-70]);
  assert.equal(base.where[0], 'm.rssi >= $1', 'sin offset empieza en $1');

  const shifted = rowFilters({ sig: -70 }, { paramOffset: 3 });
  assert.equal(shifted.where[0], 'm.rssi >= $4', 'con offset 3 va a $4');

  const bad = rowFilters({ sig: 'abc' });
  assert.deepEqual(bad, { where: [], params: [] }, 'sig inválido no genera placeholder');
});

test('rowFilters: band solo acepta bandas conocidas', () => {
  assert.equal(rowFilters({ band: '2.4' }).where.length, 1);
  assert.equal(rowFilters({ band: '5' }).where.length, 1);
  assert.equal(rowFilters({ band: '6' }).where.length, 1);
  assert.deepEqual(rowFilters({ band: '9' }), { where: [], params: [] });
});

test('los builders de SQL no dejan pasar texto del usuario', () => {
  // type y band se validan contra listas cerradas; el valor nunca se interpola.
  for (const evil of ["2.4' OR '1'='1", "'; DROP TABLE measurements; --", '../../etc/passwd']) {
    assert.deepEqual(rowFilters({ band: evil }), { where: [], params: [] }, `band=${evil}`);
    assert.deepEqual(rowFilters({ type: evil }), { where: [], params: [] }, `type=${evil}`);
  }
});

test('aggregatedOpenSql: 1 abierta, 0 protegida, NULL sin datos', () => {
  const sql = aggregatedOpenSql('m');
  assert.ok(sql.includes('FILTER'), 'filtra las filas sin capabilities');
  assert.ok(sql.includes('THEN 0 ELSE 1'), 'el 1 tiene que ser "abierta"');
  assert.ok(sql.includes("m.capabilities ILIKE '%WPA%'"), 'reconoce WPA');
  assert.ok(sql.includes("m.capabilities ILIKE '%SAE%'"), 'reconoce SAE (WiFi 3)');
});

test('aggregatedBandSql: excluye las frecuencias desconocidas', () => {
  assert.ok(aggregatedBandSql('m').includes('IS NOT NULL'));
});

test('bandSql: 6 GHz es una banda propia y frequency 0 no inventa banda', () => {
  const sql = bandSql('m');
  assert.ok(sql.includes("THEN '6'"), 'tiene bucket de 6 GHz');
  assert.ok(sql.includes('ELSE NULL'), 'sin frecuencia no hay banda');
  assert.ok(sql.includes('>= 5925'), '6 GHz arranca en 5925 MHz');
  assert.ok(!/Infinity/.test(sql), 'Infinity no es un literal válido en SQL');
});

test('signalWeightSql: pesa por señal y nunca por debajo de 0', () => {
  assert.equal(signalWeightSql('m'), 'GREATEST(m.rssi + 90, 0)');
  assert.equal(signalWeightSql(), 'GREATEST(m.rssi + 90, 0)', 'por defecto usa m');
  assert.equal(signalWeightSql(''), 'GREATEST(rssi + 90, 0)', 'sin alias, sin calificar');
});
