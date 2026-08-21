# Arquitectura

WifiMapper es una app Android clásica (Java + XML Views). Este documento describe sus componentes, el flujo de datos y las decisiones de diseño.

## Vista general

```
┌─────────────────────────────────────────────────────────────┐
│                      MainActivity (UI/mapa)                 │
│  • MapView OSMDroid        • marcadores + burbuja + pulso   │
│  • observa Room via LiveData → renderizado reactivo         │
└──────────────▲─────────────────────────────┬───────────────┘
               │ LiveData                     │ Inicia/detiene
               │                              ▼
       ┌───────┴────────┐           ┌─────────────────────────┐
       │  AppDatabase   │           │      ScanService        │
       │  (Room/SQLite) │           │  Foreground Service     │
       │  measurements  │◄──────────│  (ubicación)            │
       └────────────────┘   insert  └────────────┬────────────┘
                                                 │ usa
                                    ┌────────────▼────────────┐
                                    │   WifiScanner (singleton)│
                                    │  scanLoop adaptativo     │
                                    └────────┬────────┬────────┘
                                             │        │
                                     WifiManager    LocationHelper
                                     (resultados)   (GPS + velocidad)
```

## Componentes

### `MainActivity` *(raíz)*
- Inicializa el mapa, pide permisos en runtime y gestiona la UI (estado, leyenda, botón de seguimiento).
- Observa `observeAll()` de la base con `LiveData`; cada escritura dispara `renderSummaries()`, que actualiza los marcadores.
- `LocationHelper` propio para el **autocentrado**: en el primer fix posiciona el mapa y recién ahí activa el seguimiento.
- Gestiona el arranque/detención del `ScanService` y la exportación (menú).

### `ScanService` *(raíz)*
- `Foreground Service` de tipo `location`, con notificación persistente.
- Mantiene vivo el `WifiScanner` con la pantalla apagada o usando otras apps.
- `START_STICKY`: si el sistema lo mata, se reinicia.
- Escucha los eventos del escáner para actualizar el texto de la notificación.

### Paquete `scan`
- **`WifiScanner`**: pide `wifiManager.startScan()` en un bucle, recibe los resultados por `BroadcastReceiver`, suaviza el RSSI y los guarda en Room junto al GPS. Soporta **múltiples listeners** (actividad + servicio).
  - **Intervalo adaptativo**: `computeIntervalMs()` usa la velocidad del GPS para escanear más si vas rápido y menos si estás parado.
- **`LocationHelper`**: envuelve `LocationManager` (GPS). Expone la última posición y la **velocidad** en m/s (entre fijaciones).
- **`WifiScannerHolder`**: singleton que comparte el escáner entre Activity y Servicio.

### Paquete `data`
- **`AppDatabase`**: base Room (`wifi_mapper.db`).
- **`WifiDao`**: `insertAll`, `observeAll` (LiveData), `getAll`, `clearAll`.
- **`WifiMeasurement`**: entidad (una lectura por red por barrido).
- **`SignalAggregator`**: transforma mediciones crudas en resúmenes por red (ver `agregacion.md`).

### Paquete `overlays`
- **`PulseOverlay`**: anillo doble que se expande/desvanece al aparecer una red nueva.
- **`WifiInfoWindow`**: burbuja al tocar un punto, con botón de cierre.

### Paquete `export`
- **`Exporter`**: genera CSV y KML a partir de los resúmenes.

## Flujo de datos

1. El escáner recibe un barrido WiFi (cada 3,5–15 s según velocidad).
2. Si hay fix GPS, crea una `WifiMeasurement` por red detectada y la inserta en lote.
3. Room notifica el cambio a través de `LiveData`.
4. `MainActivity` re-agrega con `SignalAggregator` (agrupación + trilateración) y re-renderiza los marcadores.

## Decisiones de diseño

- **Persistencia reactiva (LiveData)**: el mapa se actualiza solo ante cambios en la base, sin acoplar UI ↔ escáner.
- **Escáner compartido por singleton**: garantiza que Activity y Servicio usen la misma instancia y no dupliquen recursos.
- **Varios listeners**: la Activity pinta la UI y el Servicio la notificación, sin pisarse.
- **GPS separado por rol**: uno interno al escáner (para etiquetar muestras) y otro en la Activity (para autocentrar el mapa); ambos se pausan con el ciclo de vida para ahorrar batería.
- **Datos 100 % locales**: nada se sube a la nube.
