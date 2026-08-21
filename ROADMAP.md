# Roadmap · Mapero

Funcionalidades previstas para el futuro, ordenadas por temática. Las que están ✅ **implementadas** tienen una versión inicial funcionando (ver `server/`).

## 1. ✅ Mapa web en tiempo real (v1 implementada)
- La app sube en tiempo real los datos (redes + posición + señal) a un servidor (`POST /api/measurements`).
- Un sitio web las visualiza en vivo sobre un mapa (Leaflet + OpenStreetMap), con colores por intensidad.
- Actualización en tiempo real por WebSocket.
- Muestra la **fecha de la última actualización** y el conteo de redes.
- Pendientes: autenticación, streaming más fino, filtros en la web.

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

## 3. Fecha de la última actualización del mapa
- Mostrar en la UI **cuándo** fue la última vez que se actualizaron los datos del mapa.
- En modo offline: fecha de la última medición guardada localmente.
- En modo online: fecha de la última sincronización con el servidor.

### Consideraciones
- Mantener un campo `lastUpdated` en la base/local o el estado del mapa.
- Formato legible ("hace 5 min", "ayer 18:32") y actualización al escanear/sincronizar.

## 4. ✅ Juego de conquista de zonas (modo competitivo) — v1 implementada
- Celdas **hexagonales H3 ~150 m** (resolución 10).
- Regla **cobertura + decaimiento**: por celda, cada medición aporta un peso que decae con el tiempo (~7 días); el dueño es quien más cobertura acumulada tiene.
- Competencia **individual**: cada jugador se identifica por nombre (`x-device-name`).
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
  - **Tipo**: Todas / **Abiertas** (sin cifrado) / **Protegidas**.
  - **Banda**: Todas / 2,4 GHz / 5 GHz.
  - **Señal mínima**: Todas / ≥ -80 / ≥ -70 / ≥ -60 dBm.
- Se guardan las `capabilities` de `ScanResult` (migración Room v1→v2) y cada red se clasifica como abierta/protegida y por banda.
- El filtro se combina con el filtrado por zoom ya existente (se aplican sobre los marcadores visibles).

### Pendientes
- Aplicar el filtro también a exportaciones y conteos (hoy solo afecta el mapa).

## 6. ✅ Búsqueda de redes por nombre — implementada
- Menú **Buscar** en la app: autocompletado con los SSID ya mapeados.
- Al elegir una red, el mapa se desplaza a su ubicación, muestra su marcador y abre su burbuja de información.
- 100 % local (usa los datos guardados en el dispositivo).

## 6b. ✅ Filtros combinados en el panel (mediciones)
- En **/admin → Mediciones**, además de usuario/fechas/nombre/MAC: filtros por **tipo** (abiertas/protegidas), **banda** (2,4/5 GHz) y **señal mínima**.
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

## 8. Login con Google (Gmail)
- Autenticación vía **OAuth 2.0 con Google** además del usuario/contraseña actual.
- El usuario inicia sesión con su cuenta de Gmail y el servidor asocia la identidad.

### Consideraciones
- Requiere registrar la app en Google Cloud (client id/secret) y flujo OAuth (web) / Google Sign-In (Android).
- Mapear el sub (identificador de Google) a un usuario interno.
- Compatible con el login por usuario/contraseña actual (misma identidad para conquista).

## 9. Características "Pro"
- Suscripción o plan **Pro** con funciones premium. Ideas:
  - Historial ilimitado / exportaciones avanzadas (GeoJSON, estadísticas).
  - Múltiples territorios / equipos, herramientas de análisis.
  - Mayor frecuencia de escaneo y sincronización.
  - Sin anuncios y funciones de personalización.

### Consideraciones
- Requiere gestión de suscripciones (Google Play Billing) y estado "pro" por usuario en el servidor.
- Definir qué queda gratis vs. Pro.

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

## Dependencias entre módulos
```
Mapa web (1)
   └── API (2)  ← habilitada por la misma infraestructura
Conquista (4)
   └── API (2) + mapa web (1)  ← necesita datos compartidos
Fecha de actualización (3)
   └── parte local + backend (1/2)
Filtros (5) y búsqueda (6)
   └── puramente locales (opcionalmente con backend en el futuro)
Panel admin (7) y Pro (9)
   └── requieren roles y gestión de usuarios sobre la API (2)
Login Google (8)
   └── se suma al esquema de auth (2)
Navegación (10)
   └── variante de la conquista (4) con otra fuente de datos
```

> Sugerencia de orden: primero la **API (2)**, porque habilita el mapa web (1) y la conquista (4). La fecha de actualización (3) puede hacerse de forma independiente y antes, por ser puramente local. Los **filtros (5)** y la **búsqueda (6)** también son independientes y solo requieren cambios en la app. El **panel admin (7)** y el **login Google (8)** se apoyan en la autenticación existente; las **features Pro (9)** y la **navegación (10)** son proyectos aparte.
