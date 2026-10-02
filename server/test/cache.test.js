import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TtlCache } from '../src/cache.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

test('produce una vez y reutiliza mientras viva el TTL', async () => {
  const cache = new TtlCache(1000);
  let llamadas = 0;
  const produce = () => ++llamadas;

  assert.equal(await cache.resolve('k', produce), 1);
  assert.equal(await cache.resolve('k', produce), 1);
  assert.equal(await cache.resolve('k', produce), 1);
  assert.equal(llamadas, 1, 'no vuelve a producir dentro del TTL');
});

test('vuelve a producir cuando expira el TTL', async () => {
  const cache = new TtlCache(20);
  let llamadas = 0;
  const produce = () => ++llamadas;

  assert.equal(await cache.resolve('k', produce), 1);
  await dormir(45);
  assert.equal(await cache.resolve('k', produce), 2, 'el TTL venció');
  assert.equal(llamadas, 2);
});

test('las claves son independientes', async () => {
  const cache = new TtlCache(1000);
  assert.equal(await cache.resolve('a', () => 'A'), 'A');
  assert.equal(await cache.resolve('b', () => 'B'), 'B');
  assert.equal(await cache.resolve('a', () => 'otro'), 'A', 'a sigue cacheado');
});

test('coalesce pedidos concurrentes: NAlan UNA sola producción', async () => {
  const cache = new TtlCache(1000);
  let llamadas = 0;
  // Sin coalescer, estas 20 llamadas dispararían 20 consultas a la base.
  const produce = async () => {
    llamadas++;
    await dormir(20);
    return 'valor';
  };

  const resultados = await Promise.all(
    Array.from({ length: 20 }, () => cache.resolve('k', produce)));

  assert.equal(llamadas, 1, 'los 20 pedidos esperamos la misma promesa');
  assert.deepEqual(resultados, Array(20).fill('valor'));
});

test('coalesce también cuando la producción es asíncrona y rápida', async () => {
  const cache = new TtlCache(1000);
  let llamadas = 0;
  const produce = async () => { llamadas++; return llamadas; };
  await Promise.all(Array.from({ length: 10 }, () => cache.resolve('k', produce)));
  assert.equal(llamadas, 1);
});

test('invalidate(key) fuerza la próxima producción', async () => {
  const cache = new TtlCache(100000);
  let llamadas = 0;
  const produce = () => ++llamadas;

  assert.equal(await cache.resolve('k', produce), 1);
  assert.equal(await cache.resolve('k', produce), 1, 'sigue vivo');
  cache.invalidate('k');
  assert.equal(await cache.resolve('k', produce), 2, 'la invalidación limpió la entrada');
});

test('invalidate() sin clave limpia todo', async () => {
  const cache = new TtlCache(100000);
  let llamadas = 0;
  const produce = () => ++llamadas;

  await cache.resolve('a', produce);
  await cache.resolve('b', produce);
  cache.invalidate();
  assert.equal(await cache.resolve('a', produce), 3);
  assert.equal(await cache.resolve('b', produce), 4);
});

test('si la producción falla, la entrada se saca y el siguiente reintenta', async () => {
  const cache = new TtlCache(100000);
  let intentos = 0;
  const produce = async () => {
    intentos++;
    if (intentos === 1) throw new Error('la base se cayó');
    return 'ok';
  };

  await assert.rejects(() => cache.resolve('k', produce), /la base se cayó/);
  // Si la entrada fallida se quedara cacheada, esto devolvería el error otra vez.
  assert.equal(await cache.resolve('k', produce), 'ok');
  assert.equal(intentos, 2);
});

test('un fallo no invalida las claves que sí funcionan', async () => {
  const cache = new TtlCache(100000);
  await cache.resolve('buena', () => 'ok');
  await assert.rejects(() => cache.resolve('mala', async () => { throw new Error('x'); }));
  assert.equal(await cache.resolve('buena', () => 'otro'), 'ok', 'la buena sigue cacheada');
  assert.equal(await cache.resolve('mala', () => 'ok'), 'ok', 'la mala se puede reintentar');
});

test('stats cuenta aciertos y fallos', async () => {
  const cache = new TtlCache(1000);
  await cache.resolve('k', () => 1);
  await cache.resolve('k', () => 1);
  await cache.resolve('k', () => 1);
  const s = cache.stats();
  assert.equal(s.misses, 1);
  assert.equal(s.hits, 2);
  assert.equal(s.claves, 1);
});
