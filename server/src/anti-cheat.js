/**
 * Anti-cheat de velocidad para la ingesta de mediciones.
 *
 * Vive en su propio módulo, sin estado global, para poder probarlo: es lógica
 * de seguridad y verificarla a mano con peticiones HTTP no alcanza. Cada
 * instancia lleva su propio registro de posiciones, así que los tests pueden
 * empezar de cero y no dependen del orden.
 */

/** Distancia en metros entre dos puntos, por la fórmula del haversine. */
export function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Velocidad máxima plausible (m/s). 40 m/s ≈ 144 km/h. */
export const DEFAULT_MAX_SPEED_MPS = 40;

/**
 * Desplazamiento máximo tolerado cuando no hay intervalo con el que calcular
 * una velocidad (mismo timestamp, o timestamp anterior). La app nunca se mueve
 * dentro de un lote, así que 30 m es holgado: solo cubre el ruido del GPS y un
 * reloj desfasado.
 */
export const DEFAULT_MAX_STEP_M = 30;

/** Usuarios con posición recordada. */
export const DEFAULT_MAX_TRACKED_USERS = 10000;

export class AntiCheat {
  constructor({
    maxSpeedMps = DEFAULT_MAX_SPEED_MPS,
    maxStepM = DEFAULT_MAX_STEP_M,
    maxTrackedUsers = DEFAULT_MAX_TRACKED_USERS,
  } = {}) {
    this.maxSpeedMps = maxSpeedMps;
    this.maxStepM = maxStepM;
    this.maxTrackedUsers = maxTrackedUsers;
    /** userId -> { lat, lon, ts } */
    this.lastPos = new Map();
  }

  /**
   * Descarta las mediciones imposibles para el usuario.
   *
   * El caso normal es un lote: la app lee el GPS una vez y sella todas las redes
   * de ese barrido con el mismo milisegundo y la misma coordenada, así que las
   * mediciones de un lote están a 0 m entre sí. El caso que hay que cubrir es el
   * otro: un cliente que manda muchas mediciones con el mismo timestamp y
   * coordenadas distintas, para quedarse con celdas de todo el mapa de un golpe.
   *
   * Con intervalo positivo se exige una velocidad plausible. Sin intervalo no
   * hay velocidad que calcular, así que se exige que el punto no se haya movido.
   *
   * @returns true si la medición es aceptable.
   */
  accepts(userId, lat, lon, tsMs) {
    const prev = this.lastPos.get(userId);
    let allowed = true;

    if (prev) {
      const distance = haversineM(prev.lat, prev.lon, lat, lon);
      const dtS = (tsMs - prev.ts) / 1000;
      if (dtS > 0) {
        if (distance / dtS > this.maxSpeedMps) allowed = false;
      } else if (distance > this.maxStepM) {
        allowed = false;
      }
    }

    // Solo avanza la posición de referencia con una medición aceptada y con un
    // timestamp que no retrocede, así un rechazo no habilita el siguiente salto.
    if (allowed && (!prev || tsMs >= prev.ts)) {
      // Al llegar al tope se descarta la entrada más antigua: es la que menos
      // probable es que vuelva, y perderla solo hace que ese usuario pierda la
      // referencia de un salto, no la protección de los siguientes.
      if (this.lastPos.size >= this.maxTrackedUsers && !this.lastPos.has(userId)) {
        const masAntigua = this.lastPos.keys().next().value;
        this.lastPos.delete(masAntigua);
      }
      this.lastPos.set(userId, { lat, lon, ts: tsMs });
    }
    return allowed;
  }

  /** Cuántos usuarios tienen posición recordada. */
  get size() {
    return this.lastPos.size;
  }

  /**
   * Olvida las posiciones de los usuarios que ya no ingesta hace rato.
   *
   * El registro es en memoria: al reiniciar el servidor se vacía, y un usuario
   * que vuelve tras meses no debería quedar condicionado por una posición vieja.
   */
  forgetOlderThan(cutoffMs, now = Date.now()) {
    for (const [userId, pos] of this.lastPos) {
      if (pos.ts < cutoffMs) this.lastPos.delete(userId);
    }
  }
}