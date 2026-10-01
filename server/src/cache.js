/**
 * Cachés en memoria con TTL e invalidación explícita.
 *
 * Los agregados caros (redes por SSID, territorios) se recalculan de la tabla
 * completa. Con la web abierta eso son ~114 ms por cliente cada 30 s, así que
 * se calculan una vez y se comparten.
 */
export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Devuelve el valor cacheado, o lo produce y lo guarda.
   *
   * Guarda la promesa, no el resultado: si llegan N pedidos juntos con la caché
   * vacía, los N esperan la misma consulta en vez de disparar N. Si la
   * producción falla, la entrada se saca para que el próximo pedido reintente.
   */
  resolve(key, produce) {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      this.hits++;
      return hit.value;
    }
    this.misses++;
    const value = Promise.resolve().then(produce);
    this.entries.set(key, { at: Date.now(), value });
    value.catch(() => {
      const current = this.entries.get(key);
      if (current && current.value === value) this.entries.delete(key);
    });
    return value;
  }

  /** Invalida una clave, o todas si no se pasa ninguna. */
  invalidate(key) {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }

  stats() {
    return { hits: this.hits, misses: this.misses, claves: this.entries.size };
  }
}
