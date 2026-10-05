# Roadmap · Mapero

Funcionalidades previstas para el futuro, ordenadas por temática. Las que están ✅ **implementadas** tienen una versión inicial funcionando (ver `server/`).

## 1. ✅ Mapa web en tiempo real (v1 implementada)
- La app sube en tiempo real los datos (redes + posición + señal) a un servidor (`POST /api/measurements`).
- Un sitio web las visualiza en vivo sobre un mapa (Leaflet + OpenStreetMap), con colores por intensidad.
- Actualización en tiempo real por WebSocket.
- Muestra la **fecha de la última actualización** y el conteo de redes.
- Pendientes: autenticación, streaming más fino.

### Consideraciones
- Modelo de datos a sincronizar: mismos campos que `measurements` + identificador de dispositivo/usuario.
- Manejar privacidad y autenticación antes de exponer datos públicos.
- Política de uso razonable del backend (límites de requests).

## 2. ✅ API para subir y compartir datos en tiempo real entre dispositivos (v1 implementada)
- **Ingesta**: `POST /api/measurements` (requiere sesión), ya usada por la app Android.
- **Consulta**: `GET /api/networks` (redes agregadas) para la carga inicial de la web.
- **Tiempo real**: WebSocket `/ws` que transmite cada ingesta a todos los clientes conectados.
- **Autenticación**: registro/login por usuario (bcrypt) con **token de sesión** (`Authorization: Bearer`).
- Pendientes: sincronización incremental (timestamp/offset), `GET /networks/{id}`, paginación y filtros.

### Consideraciones
- Autenticación por token/API key por usuario o dispositivo.
- Validación y deduplicación de mediciones (BSSID + timestamp).
- Paginación y filtros (zona, rango de señal, tiempo).

## 3. ✅ Fecha de la última actualización del mapa
- La web muestra la **fecha de la última actualización** y el conteo de redes.
- En la app: pendiente (mostrar en UI la última sync local/online).

### Consideraciones
- Mantener un campo `lastUpdated` en la base/local o el estado del mapa.
- Formato legible ("hace 5 min", "ayer 18:32") y actualización al escanear/sincronizar.

## 4. ✅ Juego de conquista de zonas (modo competitivo) — v1 implementada
- Celdas **hexagonales H3 ~150 m** (resolución 10).
- Regla **cobertura + decaimiento**: por celda, cada medición aporta un peso que decae con el tiempo (~7 días); el dueño es quien más cobertura acumulada tiene.
- Competencia **individual**: cada jugador se identifica por nombre (login/registro con token).
- Endpoint `GET /api/territories` (dueño de cada hexágono + score + disputa).
- Endpoint `GET /api/leaderboard` (ranking de conquistas por jugador).
- **Autenticación** por usuario (login/registro con token) — identidad establecida.
- **Anti-cheat**: se rechazan mediciones con velocidad imposible (teletransporte) entre lecturas de un mismo usuario.
- **Defensa de territorios**: las celdas se marcan **en disputa** cuando el segundo tiene ≥60% de la cobertura del dueño (borde punteado en la web).
- **Web**: hexágonos coloreados por dueño (H3) + panel de ranking/leaderboard + login.
- **App**: conexión/login (menú Servidor) y superposición de territorios en el mapa.

### Pendientes / ideas
- Anti-cheat más fino (validación de datos, deduplicación, límites de tasa).
- Decaimiento configurable y "guerra" por defensa (mecánica de reconquista).
- Detalle de celdas vecinas y "frentes" entre jugadores.

---

## 5. ✅ Filtros de tipos de red — implementados
- Menú **Filtros** en la app con:
  - **Tipo**: Todas / **Abiertas** (sin cifrado) / **Protegidas** / **Sin datos**.
  - **Banda**: Todas / 2,4 GHz / 5 GHz / **6 GHz**.
  - **Señal mínima**: Todas / ≥ -80 / ≥ -70 / ≥ -60 dBm.
  - **Usuario**: filtro por usuario específico.
  - **Buscar**: búsqueda por nombre (SSID).
  - **Ocultar redes**: lista de SSID/BSSID a excluir.
- Se guardan las `capabilities` de `ScanResult` (migración Room v1→v2) y cada red se clasifica como abierta/protegida y por banda.
- El filtro se combina con el filtrado por zoom ya existente (se aplican sobre los marcadores visibles).

### Pendientes
- ~~Aplicar el filtro también a exportaciones y conteos (hoy solo afecta el mapa).~~ ✅ **HECHO** (commit 0a6db2a)

---

## 6. ✅ Búsqueda de redes por nombre — implementada
- Menú **Buscar** en la app: autocompleta con los SSID ya mapeados.
- Al elegir una red, el mapa se desplaza a su ubicación, muestra su marcador y abre su burbuja de información.
- 100 % local (usa los datos guardados en el dispositivo).

## 6b. ✅ Filtros combinados en el panel (mediciones)
- En **/admin → Mediciones**, además de usuario/fechas/nombre/MAC: filtros por **tipo** (abiertas/protegidas), **banda** (2,4/5/6 GHz) y **señal mínima**.
- La app ahora **sube `capabilities`** de cada red al servidor (columna nueva, preserva datos).
- La tabla muestra columnas **Tipo** y **Banda**.

---

## 7. ✅ Panel de administración (web) — v1 implementada
- Ruta **`/admin`** en la web, protegida por **rol de administrador**.
- **Roles**: los usuarios tienen `role` (`user`/`admin`); el primer admin se define con `ADMIN_USER` (variable de entorno).
- Secciones:
  - **Estadísticas** del sistema (usuarios, mediciones, territorios).
  - **Usuarios** (ver, cambiar rol, borrar).
  - **Mediciones** (listar, borrar todo).
  - **Configuración** del sistema (intervalo de escaneo, calibración, resolución de hexágonos, decaimiento, umbral de disputa).
- **Config remota**: `GET /api/config` (público) — la app Android lo descarga y aplica (intervalo + calibración).

### Pendientes / ideas
- Desactivar usuarios (en vez de solo borrar), auditoría, forzar recálculo de territorios.
- Más opciones de configuración y control de roles más fino.

---

## 8. Login con Google (Gmail)
- Autenticación vía **OAuth 2.0 con Google** además del usuario/contraseña actual.
- El usuario inicia sesión con su cuenta de Gmail y el servidor asocia la identidad.

### Consideraciones
- Requiere registrar la app en Google Cloud (client id/secret) y flujo OAuth (web) / Google Sign-In (Android).
- Mapear el sub (identificador de Google) a un usuario interno.
- Compatible con el login por usuario/contraseña actual (misma identidad para conquista).

---

## 9. Características "Pro"
- Suscripción o plan **Pro** con funciones premium. Ideas:
  - Historial ilimitado / exportaciones avanzadas (GeoJSON, estadísticas).
  - Múltiples territorios / equipos, herramientas de análisis.
  - Mayor frecuencia de escaneo y sincronización.
  - Sin anuncios y funciones de personalización.

### Consideraciones
- Requiere gestión de suscripciones (Google Play Billing) y estado "pro" por usuario en el servidor.
- Definir qué queda gratis vs. Pro.

---

## 10. Versión de navegación (conquista territorial náutica — sin WiFi)
- Una variante del mapeo pensada para **navegación marítima/fluvial**:
  - En lugar de WiFi, se conquistan **territorios náuticos** (zonas de agua) por cobertura de navegación.
  - Las celdas (hexágonos) se asignan según el recorrido en agua, no por señales WiFi.
  - Puede compartir la misma infraestructura (territorios H3, leaderboard, conquista) pero con un "modo de dato" distinto (posiciones de la embarcación, sin RSSI).

### Consideraciones
- Fuente de datos: solo GPS/rumbo (sin escaneo WiFi) en el modo navegación.
- Las celdas náuticas podrían exigir estar sobre agua (filtro por tierra/agua).
- Reutiliza hexágonos H3, decaimiento y defensa; cambia la ingesta.

---

## ✅ Estado actual del proyecto (resumen)

### ✅ Completado (v1.0)
| Funcionalidad | Estado | Commits |
|---|---|---|
| **App Android** | ✅ |  |
| - Escaneo WiFi + GPS + servicio foreground | ✅ | |
| - Sync incremental por ID (cursor) | ✅ | |
| - Rate limit ingesta (2000 req/min) | ✅ | |
| - Cursor por ID + paginación 200 | ✅ | |
| - Migración timestamp → ID | ✅ | |
| - Race condition enqueue/insert | ✅ Fix aplicado | |
| - Parámetro `days` en `/api/networks` | ✅ | |
| **Seguridad & Privacidad** | | |
| - Token/password cifrado (EncryptedSharedPreferences) | ✅ | |
| - Rate limit ingesta (2000 req/min + Retry-After) | ✅ | |
| - Rate limit login/registro | ✅ | |
| - Contraseña mínima 8 chars | ✅ | |
| - Sesiones con expiración (30 días) + logout | ✅ | |
| - CORS same-origin por defecto | ✅ | |
| - `lastPos` con TTL (6h) y tope 10k | ✅ | |
| **Paridad app/servidor** | | |
| - Seguridad tri-estado (abiertas/protegidas/sin datos) | ✅ 1198/1198 | |
| - Banda 6 GHz (band=3) | ✅ | |
| - Filtros export CSV/KML | ✅ | |
| **Servidor** | | |
| - Rate limit login (10/15min) + registro (5/h) | ✅ | |
| - Rate limit ingesta (2000 req/min) | ✅ | |
| - Dedup ON CONFLICT (user_id, bssid, ts) | ✅ | |
| - Índice único (user_id, bssid, ts) | ✅ | |
| - Anti-cheat velocidad + anti-teleport | ✅ | |
| - Sesiones con expiración (30 días) + logout | ✅ | |
| - CORS same-origin por defecto | ✅ | |
| - `lastPos` TTL 6h + tope 10k usuarios | ✅ | |
| - `lastPos` limpieza periódica | ✅ | |
| **Tests & CI** | | |
| - Tests servidor: 77 (Node) | ✅ | |
| - Tests Android: 50 (19 JVM + 7 Room + 25 SignalAggregator) | ✅ | |
| - Migración Room 2→4 probada (Robolectric) | ✅ | |
| - Anti-cheat: 24 tests (Robolectric) | ✅ | |
| - Filtros: 25 tests | ✅ | |
| - Trilateration: 8 tests | ✅ | |
| - CI GitHub Actions | ✅ | |
| **Infra / Deploy** | | |
| - Docker compose (backend + PostgreSQL) | ✅ | |
| - CI GitHub Actions (tests + build) | ✅ | |
| - `targetSdk 35` | ✅ | |
| - `compileSdk 35` | ✅ | |
| - `minSdk 26` | ✅ | |

---

## 📋 Pendientes (Backlog priorizado)

| # | Qué | Esfuerzo | Comentario |
|---|---|---|---|
| **1** | **Keystore + Signing config** | 5 min | `keytool -genkeypair -v -keystore keystore.jks -alias mapero -keyalg RSA -keysize 2048 -validity 10000` |
| **2** | **Signing config en `build.gradle`** | 5 min | `signingConfigs.release` con variables de entorno |
| **3** | **Iconos adaptativos** | 10 min | Android Studio → `New > Image Asset` |
| **4** | **Feature graphic** (1024×500) + capturas | 30 min | Requerido en Play Console |
| **3** | **Política de privacidad** (URL) | 30 min | Hostear en GitHub Pages / web propia |
| **4** | **Feature graphic** (1024×500) + capturas | 30 min | Requerido en Play Console |
| **5** | **Política de privacidad** (URL) | 30 min | Hostear en GitHub Pages / web propia |
| **6** | **Build AAB** | 2 min | `./gradlew :app:bundleRelease` |
| **7** | **Subir a Play Console → Internal Testing** | 10 min | Test en dispositivo real |
| **8** | **Completar ficha Play Console → enviar a revisión** | 30 min | |

---

## 🎯 Próximos pasos recomendados

1. **Generar keystore** (una vez):
   ```bash
   keytool -genkeypair -v -keystore keystore.jks -alias mapero -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Configurar signing en `build.gradle`** (usar variables de entorno para passwords):
   ```gradle
   signingConfigs {
       release {
           storeFile file("../keystore.jks")
           storePassword System.getenv("KEYSTORE_PASSWORD")
           keyAlias "mapero"
           keyPassword System.getenv("KEY_PASSWORD")
       }
   }
   ```

3. **Generar AAB**:
   ```bash
   ./gradlew :app:bundleRelease
   ```

4. **Subir a Play Console > Internal Testing** → test en dispositivo real

5. **Completar ficha Play Console** → enviar a revisión

---

## 📋 Checklist de publicación Play Store

| ✅ | Ítem |
|---|---|
| [ ] `targetSdk 35` | ✅ |
| [ ] `compileSdk 35` | ✅ |
| [ ] `minSdk 26` | ✅ |
| [ ] `ACCESS_BACKGROUND_LOCATION` | ✅ Manifest |
| [ ] `POST_NOTIFICATIONS` runtime | ✅ Runtime request |
| [ ] `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` | ✅ Manifest + Service |
| `ACCESS_BACKGROUND_LOCATION` | ✅ Manifest |
| `FOREGROUND_SERVICE_LOCATION` | ✅ Manifest + Service |
| Rate limit ingesta | ✅ 2000 req/min + `Retry-After` |
| `days` param `/api/networks` | ✅ Sin default |
| Filtros export CSV/KML | ✅ Mismos criterios que mapa |
| 6 GHz / Seguridad tri-estado | ✅ Paridad 1198/1198 |
| Anti-cheat testeado | ✅ 24 tests Robolectric |
| Migración Room 2→4 testeada | ✅ 7 tests Robolectric |
| Deduplicación BD | ✅ 14.508 filas borradas |
| Índice único dedup | ✅ (en arranque, tras limpieza) |
| Cursor id en app | ✅ Sin migración (usa PK) |
| Paginación syncAll | ✅ Páginas de 200 |
| Cursor id + migración timestamp→id | ✅ |
| Race condition enqueue/insert | ✅ Arreglado |
| Cursor avanza con max id intentado | ✅ |
| Mapeo timestamp→id en upgrade | ✅ |
| 6 GHz app | ✅ `band=3`, paridad 1198/1198 |
| Seguridad tri-estado | ✅ 1198/1198 redes coinciden |
| Filtros export CSV/KML | ✅ Mismos criterios que mapa |
| 6 GHz paridad | Tests cubren límites 5924/5925 |
| Seguridad tri-estado | 1198/1198 redes coinciden app/servidor |
| Tests totales: 127 | 77 server + 50 Android |
| CI GitHub Actions | Corre tests en cada push |
| EncryptedSharedPreferences | Token/password cifrados (AES256-GCM, Keystore) |
| Rate limit ingesta | 2000 req/min + `Retry-After` |
| targetSdk 35 | Play Store ready |
| Parámetro `days` | `/api/networks?days=N` sin default |
| Filtros export CSV/KML | Mismos criterios que mapa |

---

## 📋 Pendientes reales para Play Store (lo único que queda)

| # | Qué | Esfuerzo | Comentario |
|---|---|---|---|
| **1** | **Keystore de firma** | 5 min | `keytool -genkeypair -v -keystore keystore.jks -alias mapero -keyalg RSA -keysize 2048 -validity 10000` |
| **2** | **Signing config en `build.gradle`** | 5 min | `signingConfigs.release` con variables de entorno |
| **3** | **Iconos adaptativos** | 10 min | Android Studio → `New > Image Asset` |
| **4** | **Feature graphic** (1024×500) + capturas | 30 min | Requerido en Play Console |
| **5** | **Política de privacidad** (URL) | 30 min | Hostear en GitHub Pages / web propia |
| **6** | **Feature graphic** (1024×500) + capturas | 30 min | Requerido en Play Console |
| **5** | **Política de privacidad** (URL) | 30 min | Hostear en GitHub Pages / web propia |
| **6** | **Build AAB** | 2 min | `./gradlew :app:bundleRelease` |
| **7** | **Subir a Play Console → Internal Testing** | 10 min | Test en dispositivo real |
| **8** | **Completar ficha Play Console** → enviar a revisión | 30 min | |

---

**Tiempo estimado total: ~2 horas** (todo mecánico, sin tocar lógica)

---

> **El código está listo y probado.** Lo que queda es puramente trámite de publicación (keystore, iconos, ficha de tienda, privacy policy). ¿Generamos el keystore y configuramos el signing config ahora, o lo dejamos para cuando vayas a subirlo de verdad?