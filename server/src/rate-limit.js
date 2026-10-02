/**
 * Límite de intentos en memoria, por clave (normalmente IP + usuario).
 *
 * Sin esto, /api/auth/login acepta intentos ilimitados y una contraseña de 8
 * caracteres se puede agotar por fuerza bruta. Es un contador en memoria a
 * propósito: no necesita coordinación entre instancias y reiniciar el servidor
 * lo limpia, que es justo lo que uno quiere tras un intento de fuerza bruta.
 */
export class RateLimiter {
  /**
   * @param windowMs  Ventana de conteo.
   * @param max       Intentos permitidos por ventana.
   */
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  /**
   * Registra un intento. Devuelve `{ allowed, remaining, retryAfterS }`.
   * `allowed` en false significa que hay que esperar `retryAfterS` segundos.
   */
  hit(key, now = Date.now()) {
    const entry = this.hits.get(key);

    if (!entry || now - entry.startedAt >= this.windowMs) {
      this.hits.set(key, { startedAt: now, count: 1 });
      return { allowed: true, remaining: this.max - 1, retryAfterS: 0 };
    }

    entry.count++;
    if (entry.count > this.max) {
      const retryAfterS = Math.ceil((entry.startedAt + this.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfterS };
    }
    return { allowed: true, remaining: this.max - entry.count, retryAfterS: 0 };
  }

  /** Descarta el conteo de una clave (tras un login exitoso). */
  reset(key) {
    this.hits.delete(key);
  }

  /**
   * Saca las entradas cuya ventana ya cerró. Sin esto el Map crece con cada
   * IP que intenta una vez y nunca se limpia.
   */
  sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) {
      if (now - entry.startedAt >= this.windowMs) this.hits.delete(key);
    }
  }

  get size() {
    return this.hits.size;
  }
}
