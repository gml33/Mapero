# WifiMapper

Aplicación Android que **mapea redes WiFi en el espacio**: escanea las señales mientras caminás, registra su intensidad junto a las coordenadas GPS y las representa sobre un mapa de OpenStreetMap con colores según la potencia de la señal.

Ideal para trazar la cobertura de una zona, localizar puntos de acceso o construir un mapa de redes similar a *Wigle.net*.

---

## ✨ Características

- **Escaneo WiFi continuo** mientras caminás, con GPS.
- **Servicio en primer plano** (`Foreground Service`): sigue mapeando con la pantalla apagada o usando otras apps, con notificación persistente.
- **Intervalo de escaneo adaptativo por velocidad**: a mayor velocidad, más escaneos por minuto.
- **Autocentrado del mapa**: al abrir la app centra en tu posición y solo después activa el seguimiento.
- **Streaming opcional**: botón para alternar entre subir los datos en tiempo real al servidor (web en vivo) o almacenarlos solo en el dispositivo.
- **Cuentas y login**: registro/inicio de sesión por usuario (bcrypt + token), en la app y en la web.
- **Juego de conquista**: hexágonos que se conquistan por cobertura (con decaimiento); territorios coloreados por dueño en web y app, con leaderboard y ranking.
- **Agrupación por red (SSID)**: fusiona en un punto todas las antenas del mismo nombre.
- **Trilateración multiseñal** por mínimos cuadrados (Gauss-Newton) con modelo de propagación log-distance.
- **Menú de calibración**: ajusta la potencia de referencia y el exponente de pérdida para mejorar la precisión según el entorno.
- **Color por intensidad** de señal (verde / ámbar / rojo).
- **Filtrado por zoom**: en zonas con muchas redes muestra según el nivel de acercamiento, priorizando las de mayor señal en zoom lejano.
- **Filtros de red**: filtrar el mapa por tipo (abiertas/protegidas), banda (2,4/5 GHz) y señal mínima, desde el menú (⋮) → Filtros.
- **Animación sutil** ("pulso") al aparecer una red nueva.
- **Burbuja de información** al tocar un punto (nombre de la red + señal + muestras), con botón de cierre.
- **Exportación a CSV y KML** (compatible con Google Earth).
- **Leyenda** de colores en pantalla.

---

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | Java |
| UI | XML Views + Material Components |
| Mapa | OSMDroid (OpenStreetMap, sin API key) |
| Persistencia | Room (SQLite) |
| Ciclo de vida | AppCompat / Lifecycle (LiveData) |

**Requisitos mínimos:** Android 8.0 (API 26) · target SDK 34.

---

## 📁 Estructura del proyecto

```
.
├── android/        # App Android (Gradle + Java) — ver app/
│   └── app/        #   módulo de la aplicación
├── server/         # Backend (API + web en tiempo real) — Node.js
├── docs/           # Documentación técnica
├── README.md
└── ROADMAP.md      # Funcionalidades futuras
```

## 🚀 Compilar e instalar

El proyecto está organizado en dos carpetas: **`android/`** (la app) y **`server/`** (el backend y la web). Los comandos de la app se ejecutan dentro de `android/`.

Requisitos de entorno: **JDK 17**, **Android SDK 34** y **Gradle wrapper** incluido.

```bash
cd android

# Compilar APK de debug
./gradlew :app:assembleDebug

# Instalar en un dispositivo conectado
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Compilar e instalar directamente
./gradlew :app:installDebug
```

> `android/local.properties` debe apuntar a tu SDK: `sdk.dir=/ruta/al/Android/sdk`. No se versiona.

---

## 📱 Uso

1. **Abrí la app** y aceptá los permisos (ubicación, dispositivos WiFi cercanos y notificaciones).
2. **Iniciá el mapeo** (botón flotante). Podés cerrar o apagar la pantalla; el servicio sigue escaneando.
   - Para **subir datos** al servidor hace falta estar conectado: **menú (⋮) → Servidor → Conectar** (usuario + contraseña; si no existe se crea).
   - Usá el botón **"Streaming: ON/OFF"** (abajo a la izquierda) para decidir si los datos se suben en vivo al servidor o se guardan solo en el dispositivo.
   - Al **conectar** o al **activar el streaming**, la app sube automáticamente las mediciones pendientes que se hicieron con streaming apagado.
3. **Caminá** por la zona a mapear.
4. Al volver, la app muestra los puntos coloreados por intensidad sobre las cuadras recorridas.
5. Usá el **menú (⋮)** para **exportar a CSV/KML**, **borrar** los datos o **calibrar** la trilateración (potencia a 1 m y exponente de pérdida).

### Controles del mapa
- **Seguir (ON/OFF)**: activa/desactiva el centrado automático en tu posición. Se apaga solo al deslizar el mapa.
- **Tocar un punto**: muestra el nombre de la red y sus datos. Cerrar con la **X**.
- **Pellizco**: zoom. En zonas densas, el mapa prioriza las redes de mayor señal al alejar.

---

## 🔒 Permisos

| Permiso | Uso |
|---|---|
| `ACCESS_WIFI_STATE` / `CHANGE_WIFI_STATE` | Escaneo WiFi |
| `ACCESS_FINE_LOCATION` / `COARSE` | GPS + escaneo (API < 31) |
| `NEARBY_WIFI_DEVICES` | Escaneo WiFi (API 33+) |
| `POST_NOTIFICATIONS` | Notificación del servicio |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION` | Servicio en primer plano |
| `INTERNET` / `ACCESS_NETWORK_STATE` | Tiles del mapa |

---

## 🗂️ Arquitectura

La documentación detallada está en [`docs/`](docs/):

- [`docs/arquitectura.md`](docs/arquitectura.md): componentes, flujo de datos y decisiones.
- [`docs/agregacion.md`](docs/agregacion.md): lógica de agrupación y trilateración.

### Módulos

| Paquete | Responsabilidad |
|---|---|
| *(raíz)* | `MainActivity` (UI + mapa), `ScanService` (escaneo en 2º plano) |
| `data` | Room, entidades, DAO y agregación de señales |
| `scan` | Escáner WiFi, GPS y singleton compartido |
| `overlays` | Animaciones y burbuja de información del mapa |
| `export` | Generación de CSV / KML |

---

## 🗄️ Modelo de datos

Tabla `measurements` — una fila por cada red detectada en cada barrido (con su GPS):

| Campo | Descripción |
|---|---|
| `id` | Clave primaria autoincremental |
| `bssid` | MAC del punto de acceso |
| `ssid` | Nombre de la red (puede estar vacío) |
| `latitude` / `longitude` | Posición GPS al detectarse |
| `rssi` | Intensidad en dBm (suavizada) |
| `frequency` | Frecuencia del canal |
| `timestamp` | Momento de la medición |

---

## 🌐 Servidor y mapa web en tiempo real

La app puede subir sus mediciones a un servidor que las muestra en un **mapa web en vivo**. Ver [`server/README.md`](server/README.md).

- **Backend**: Node.js + Express + WebSocket + PostgreSQL.
- **API**: `POST /api/measurements` (ingesta), `GET /api/networks` (agregadas), `WS /ws` (broadcast).
- **Web**: mapa Leaflet (OpenStreetMap) con actualización en tiempo real y fecha de última actualización.
- **Docker**: el stack completo (backend + PostgreSQL) corre con `docker compose up -d --build` para desplegarlo en un VPS. Variables en `.env.example`.
- **Panel de administración** en `/admin`: gestión de usuarios, mediciones, estadísticas y configuración del sistema (roles `admin`/`user`).
- **Config remota**: la app descarga `/api/config` (intervalo de escaneo y calibración) y la aplica.
- En la app: **menú (⋮) → Servidor** para conectarse (usuario + contraseña).

## 🗺️ Roadmap

Las funcionalidades planificadas (mapa web en tiempo real, API para compartir datos entre dispositivos, fecha de última actualización y juego de conquista de zonas) están detalladas en [`ROADMAP.md`](ROADMAP.md).

---

## 🧭 Notas técnicas

- **RSSI suavizado:** se aplica una media móvil exponencial (α=0.5) por BSSID y se descartan saltos >30 dBm para eliminar ruido.
- **Calibración por defecto:** `P0 = -45 dBm`, `n = 2.0` (exponente de espacio libre), optimizada para mediciones en la calle. Ajustable desde el menú *Calibrar*.
- **Límites del sistema:** Android limita cuántos escaneos WiFi permite por minuto (sobre todo en segundo plano); la app pide según su intervalo, pero el SO puede espaciarlos.
- **Velocidad óptima:** caminata normal de ~4–5 km/h equilibra cobertura y muestras por red (ver `docs/agregacion.md`).

---

## 🛠️ Solución de problemas

- **La app se cierra al abrir:** reinstalá desde cero (`adb uninstall` + `install`); asegurate de que el tema sea `AppTheme` (Material). Ver historial de la rama.
- **No se ven redes nuevas:** verificá que el WiFi esté encendido y que hayas concedido `NEARBY_WIFI_DEVICES` / `ACCESS_FINE_LOCATION`; el escaneo solo guarda datos cuando hay fix de GPS.
- **El mapa no carga tiles:** se necesita conexión a internet (OpenStreetMap).

---

## 📄 Licencia

Proyecto de uso personal/educativo. No recopila ni envía datos a terceros; toda la información queda almacenada localmente.
