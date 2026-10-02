/**
 * Filtros de red compartidos por /api/networks y /api/admin/measurements.
 *
 * Las piezas devuelven siempre SQL parametrizado y los valores de `type`, `band`
 * y `sig` se validan acá, para que un parámetro inválido no rompa la consulta
 * (un `Number('abc')` sin validar llegaba a Postgres como NaN y devolvía 500).
 */

/** Marcadores de cifrado que hacen que una red se considere protegida. */
const SECURE_MARKERS = ['WPA', 'WEP', 'RSN', 'SAE', 'PSK'];

/** Bandas WiFi: 2,4 GHz · 5 GHz · 6 GHz (WiFi 6E). `max: null` = sin tope. */
const BANDS = [
  { value: '2.4', min: 1, max: 2999 },
  { value: '5', min: 3000, max: 5924 },
  { value: '6', min: 5925, max: null },
];

/** Bandas aceptadas por el parámetro `band`. */
export const BAND_VALUES = BANDS.map((b) => b.value);

/**
 * Devuelve el SQL que clasifica la banda de una fila.
 * Devuelve NULL cuando la frecuencia es desconocida, para no inventar una banda.
 */
export function bandSql(alias = '') {
  const col = alias ? `${alias}.frequency` : 'frequency';
  const cases = BANDS.map((b) => {
    const range = b.max === null
      ? `${col} >= ${b.min}`
      : `${col} BETWEEN ${b.min} AND ${b.max}`;
    return `WHEN ${range} THEN '${b.value}'`;
  }).join(' ');
  return `(CASE ${cases} ELSE NULL END)`;
}

/** SQL que vale true si la fila tiene cifrado (WPA/WEP/RSN/SAE/PSK). */
export function protectedSql(alias = '') {
  const col = alias ? `${alias}.capabilities` : 'capabilities';
  return `(${SECURE_MARKERS.map((m) => `${col} ILIKE '%${m}%'`).join(' OR ')})`;
}

/**
 * SQL que vale true si la fila informa `capabilities`.
 * Las mediciones anteriores a esa columna no se pueden clasificar: son
 * "desconocido", no "abierta".
 */
export function knownCapsSql(alias = '') {
  const col = alias ? `${alias}.capabilities` : 'capabilities';
  return `(${col} IS NOT NULL AND ${col} <> '')`;
}

/**
 * Estado de seguridad agregado de un grupo de mediciones: 1 = abierta,
 * 0 = protegida, NULL = sin datos de `capabilities`.
 * Usa la moda entre las filas que sí informan `capabilities`, en vez de asumir
 * que una red es abierta porque alguna de sus mediciones no dice nada.
 * El 1 corresponde a "abierta" para que el `::boolean` sea el valor directo.
 */
export function aggregatedOpenSql(alias = 'm') {
  return `MODE() WITHIN GROUP (
            ORDER BY CASE WHEN ${protectedSql(alias)} THEN 0 ELSE 1 END
          ) FILTER (WHERE ${knownCapsSql(alias)})`;
}

/** Banda agregada de un grupo: la moda entre las filas con frecuencia conocida. */
export function aggregatedBandSql(alias = 'm') {
  return `MODE() WITHIN GROUP (ORDER BY ${bandSql(alias)})
          FILTER (WHERE ${bandSql(alias)} IS NOT NULL)`;
}

/**
 * Peso de una medición para el centroide de la red: lineal en la señal.
 * La muestra más fuerte es la que está más cerca del access point, así que
 * pesa más. Se corta en 0 para que las señales muy débiles no resten.
 */
export function signalWeightSql(alias = 'm') {
  const col = alias ? `${alias}.rssi` : 'rssi';
  return `GREATEST(${col} + 90, 0)`;
}

/**
 * Valor de `sig` si es un número usable, o `undefined`.
 *
 * Rechaza null, undefined y cadenas vacías a propósito: `Number(null)` y
 * `Number('')` dan 0, que es un número válido, y `sig=0` significa "señales de
 * 0 dBm o más", que ninguna red cumple. Sin este filtro, `?sig=null` vaciaría
 * el mapa en vez de ignorar el parámetro.
 */
function minSignal(query) {
  const v = query.sig;
  if (typeof v !== 'number' && typeof v !== 'string') return undefined;
  if (typeof v === 'string' && v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Condiciones de fila para listar mediciones individuales (panel admin).
 * `type` y `band` se evalúan por medición; `sig` compara el rssi de la fila.
 *
 * `paramOffset` es la cantidad de parámetros que el llamador ya tiene en su
 * array: los placeholders `$N` se numeran a partir de ahí para no chocar con
 * ellos. Devuelve `{ where, params }`; los valores no reconocidos se ignoran.
 */
export function rowFilters(query = {}, { alias = 'm', paramOffset = 0 } = {}) {
  const where = [];
  const params = [];
  const prefix = alias ? `${alias}.` : '';

  if (query.type === 'open') {
    where.push(`${knownCapsSql(alias)} AND NOT ${protectedSql(alias)}`);
  } else if (query.type === 'protected') {
    where.push(protectedSql(alias));
  } else if (query.type === 'unknown') {
    where.push(`NOT ${knownCapsSql(alias)}`);
  }

  if (query.band && BAND_VALUES.includes(String(query.band))) {
    where.push(`${bandSql(alias)} = '${query.band}'`);
  }

  const min = minSignal(query);
  if (min !== undefined) {
    params.push(min);
    where.push(`${prefix}rssi >= $${paramOffset + params.length}`);
  }

  return { where, params };
}

/**
 * Predicado equivalente para filtrar en memoria el agregado de redes.
 *
 * `type` y `band` se evalúan sobre el valor agregado de la red (la moda entre
 * sus mediciones), no por medición: es lo mismo que aplicaba el HAVING y lo que
 * evalúa la web en el navegador. Filtrar en memoria evita repetir la agregación
 * completa por cada cliente y por cada cambio de filtro.
 *
 * Devuelve una función `(network) => boolean`. Los valores no reconocidos se
 * ignoran, igual que en `rowFilters`.
 */
export function networkPredicate(query = {}) {
  const { type, user, q } = query;
  // Igual que `rowFilters`: una banda que no existe se ignora en vez de vaciar
  // el resultado. Sin esta validación, `?band=xyz` dejaba el mapa sin redes.
  const band = BAND_VALUES.includes(String(query.band)) ? String(query.band) : null;
  const min = minSignal(query) ?? null;
  const needle = q ? String(q).toLowerCase() : '';

  return (n) => {
    if (type === 'open' && n.open !== true) return false;
    if (type === 'protected' && n.open !== false) return false;
    if (type === 'unknown' && n.open !== null) return false;
    if (band && n.band !== band) return false;
    if (min !== null && Number(n.rssi) < min) return false;
    if (user && !(n.users || []).includes(user)) return false;
    if (needle && !String(n.name || '').toLowerCase().includes(needle)) return false;
    return true;
  };
}
