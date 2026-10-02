import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../src/rate-limit.js';

test('deja pasar hasta el máximo y después bloquea', () => {
  const rl = new RateLimiter(1000, 3);
  assert.equal(rl.hit('a', 0).allowed, true);
  assert.equal(rl.hit('a', 10).allowed, true);
  const tercero = rl.hit('a', 20);
  assert.equal(tercero.allowed, true);
  assert.equal(tercero.remaining, 0);
  const cuarto = rl.hit('a', 30);
  assert.equal(cuarto.allowed, false, 'el cuarto intento se bloquea');
  assert.ok(cuarto.retryAfterS > 0, 'dice cuánto esperar');
});

test('la ventana se reabre pasado el plazo', () => {
  const rl = new RateLimiter(1000, 2);
  rl.hit('a', 0);
  rl.hit('a', 100);
  assert.equal(rl.hit('a', 200).allowed, false, 'dentro de la ventana bloquea');
  assert.equal(rl.hit('a', 1500).allowed, true, 'pasada la ventana vuelve a pasar');
});

test('las claves son independientes', () => {
  const rl = new RateLimiter(1000, 1);
  assert.equal(rl.hit('a', 0).allowed, true);
  assert.equal(rl.hit('b', 0).allowed, true, 'otra clave no hereda el bloqueo');
  assert.equal(rl.hit('a', 10).allowed, false);
});

test('reset limpia el conteo (tras un login exitoso)', () => {
  const rl = new RateLimiter(1000, 2);
  rl.hit('a', 0);
  rl.hit('a', 10);
  assert.equal(rl.hit('a', 20).allowed, false);
  rl.reset('a');
  assert.equal(rl.hit('a', 30).allowed, true, 'reset devuelve el contador a cero');
});

test('sweep saca las entradas vencidas para que el Map no crezca', () => {
  const rl = new RateLimiter(1000, 5);
  for (let i = 0; i < 100; i++) rl.hit(`ip-${i}`, 0);
  assert.equal(rl.size, 100, 'se acumularon todas');
  rl.sweep(2000);
  assert.equal(rl.size, 0, 'pasada la ventana, ninguna queda');
});

test('sweep no borra lo que todavía está en ventana', () => {
  const rl = new RateLimiter(10000, 5);
  rl.hit('viejo', 0);
  rl.hit('nuevo', 8000);
  rl.sweep(11000);           // 'viejo' venció (11000 >= 10000); 'nuevo' no
  assert.equal(rl.size, 1, 'solo se va la que venció');
  assert.equal(rl.hit('nuevo', 11100).allowed, true, 'la vigente sigue contando');
});

test('retryAfterS baja a medida que se acerca el fin de la ventana', () => {
  const rl = new RateLimiter(10000, 1);
  rl.hit('a', 0);
  const temprano = rl.hit('a', 1000);   // faltan ~9 s
  const tarde = rl.hit('a', 8000);      // faltan ~2 s
  assert.equal(temprano.retryAfterS, 9);
  assert.equal(tarde.retryAfterS, 2);
  assert.ok(tarde.retryAfterS < temprano.retryAfterS, 'espera menos cuando falta menos');
});

test('retryAfterS nunca baja de 1 segundo', () => {
  const rl = new RateLimiter(1000, 1);
  rl.hit('a', 0);
  assert.equal(rl.hit('a', 999).retryAfterS, 1, 'a 1 ms de cerrar no dice 0');
});
