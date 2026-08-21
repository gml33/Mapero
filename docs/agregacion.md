# Agregación y trilateración de señales

Las mediciones crudas (una por red por barrido) se transforman en un punto por red mediante `SignalAggregator`. Este documento explica esa lógica y las decisiones detrás.

## Agrupación por red

Cada lectura tiene un **BSSID** (MAC del punto de acceso) y un **SSID** (nombre de la red).

Problema: una misma red suele estar servida por **varias antenas** (repetidores, malla), cada una con su BSSID pero **el mismo SSID**. Si agrupáramos solo por BSSID, veríamos varios puntos de la "misma red".

**Solución:** se agrupa por **nombre de red (SSID)**. Si el SSID se desconoce (red oculta / sin nombre), se usa el BSSID como clave para no mezclar redes anónimas distintas.

```
clave = (ssid no vacío) ? ssid : bssid
```

## Trilateración multiseñal

Dentro de un grupo, se estima la **posición** del origen de la señal usando **todas** las mediciones, no solo la más fuerte. Implementación en `Trilateration.java`.

### 1. Conversión RSSI → distancia

Se usa el modelo de **pérdida de trayectoria log-distance**:

```
d = 10^((P0 − RSSI) / (10 · n))
```

con `P0 = -45 dBm` (señal estimada a 1 m) y `n = 2.0` (exponente de pérdida en espacio libre / exterior). Estos valores por defecto están optimizados para **mediciones en la calle**; la distancia se acota a un mínimo de 1 m. Ambos parámetros son **configurables** desde el menú *Calibrar*.

### 2. Resolución por mínimos cuadrados (Gauss-Newton)

Con **≥ 3 muestras**, se resuelve la posición `p` que minimiza el error de distancia a todas las muestras:

```
min  Σ wᵢ · (‖p − pᵢ‖ − dᵢ)²
```

- Se parte de un **centroide ponderado** por `1/dᵢ²` (las muestras cercanas dominan).
- Se itera con **Gauss-Newton** (máx. 10 iteraciones, convergencia < 0,1 m).
- Peso `wᵢ = 1/(dᵢ² + 1)` para atenuar muestras lejanas o ruidosas.
- Las coordenadas se trabajan en **metros** locales (proyección alrededor del centroide) y luego se devuelven a lat/lon.

Con **2 muestras o menos**, se cae al centroide ponderado o, en última instancia, a la muestra de mejor señal.

**RSSI del punto** = promedio simple de todas las muestras del grupo (se usa para el color).

> Nota: los parámetros del modelo (P0, n) son valores típicos de interiores. Se pueden calibrar por punto de acceso para mayor precisión, a costa de más complejidad.

## Suavizado del RSSI (en el escáner)

Antes de guardar, `WifiScanner` filtra el ruido:

- **Media móvil exponencial** por BSSID: `suavizado = α·nuevo + (1-α)·previo`, con `α = 0.5`.
- Se **descartan saltos > 30 dBm** entre lecturas consecutivas (picos imposibles por ruido).

Esto estabiliza el color del punto y la posición estimada.

## Velocidad óptima de caminata

| Situación | Efecto en el mapeo |
|---|---|
| **4–5 km/h (óptimo)** | ~8 m entre barridos de 6 s: buena diversidad de posición y varias muestras por red (~5–8) |
| Parado / muy lento | Muestras redundantes (misma posición): no dañan, no mejoran |
| Corriendo | Pocas muestras por red y RSSI más ruidoso → punto menos preciso |

## Escaneo adaptativo

El intervalo entre barridos se ajusta a la velocidad del GPS (`computeIntervalMs`):

| Velocidad | Intervalo |
|---|---|
| < 0,8 m/s | 12 s |
| < 1,5 m/s | 8 s |
| < 2,5 m/s | 6 s |
| ≥ 2,5 m/s | 3,5 s |

Limitado entre 3,5 s y 15 s.

> **Límite de plataforma:** Android acota cuántos escaneos WiFi permite por minuto (especialmente en segundo plano). La app los pide según su intervalo, pero el sistema operativo puede espaciarlos de forma transparente.
