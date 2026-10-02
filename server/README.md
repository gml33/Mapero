# Servidor Mapero

API y mapa web en tiempo real. Recibe las mediciones de la app Android, las guarda en PostgreSQL y las transmite por WebSocket a la página web.

## Requisitos
- Node.js 18+ y npm.
- PostgreSQL (16+).

## Configuración

```bash
# 1) Crear la base y el usuario (una sola vez)
createdb -O mapero mapero        # requiere rol "mapero" con password

# 2) Configurar variables
cp .env.example .env             # editar si hace falta (URL DB, API key, puerto)

# 3) Instalar dependencias
npm install
```

Variables de `.env`:
| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP/WS |
| `DATABASE_URL` | `postgres://mapero:mapero_dev@localhost:5432/mapero` | Conexión PostgreSQL |
| `API_KEY` | `mapero_dev_key` | Clave de escritura usada por la app |
| `CORS_ORIGIN` | *(vacío)* | Orígenes externos permitidos. Vacío = same-origin. |

## Ejecutar (local)

```bash
npm start          # o: npm run dev (reinicia ante cambios)
```

Al arrancar crea automáticamente las tablas (`devices`, `measurements`).

## Ejecutar con Docker (recomendado para producción/VPS)

Desde la raíz del proyecto (donde está `docker-compose.yml`), el stack levanta **PostgreSQL + backend/web**:

```bash
# Variables (opcional; hay valores por defecto para dev)
export POSTGRES_PASSWORD=clave_segura
export API_KEY=clave_api
export PORT=8080

# Construir y levantar
docker compose up -d --build
```

- `db`: PostgreSQL 16 con volumen persistente (`pgdata`).
- `web`: imagen del backend (ver `server/Dockerfile`), espera a que la DB esté sana y expone el puerto.
- Las variables se pasan vía entorno: `DATABASE_URL`, `API_KEY`, `CORS_ORIGIN`, `PORT`.

Para detener: `docker compose down` (con `-v` borra también el volumen de datos).

## Panel de administración
- Web en **`/admin`**: estadísticas, usuarios (rol/borrado), mediciones y configuración del sistema.
- Acceso restringido al **rol admin**. Definí el primer administrador con la variable `ADMIN_USER` (debe ser un usuario ya registrado); su rol se marca `admin` al arrancar, **solo si la base no tiene ningún admin todavía**.
- La app Android descarga `GET /api/config` y aplica el intervalo de escaneo y la calibración editados desde el panel.

## Despliegue en un VPS

1. Llevá el proyecto (o el `docker-compose.yml` + `server/`) al VPS.
2. Instalá Docker y Docker Compose.
3. Configurá las variables (`POSTGRES_PASSWORD`, `API_KEY`) — para producción, con una **API key fuerte**.
4. `docker compose up -d --build`.
5. Exponé el puerto (80/443) y, si usás HTTPS, un *reverse proxy* (Caddy/nginx) hacia el puerto del contenedor.
6. En cada dispositivo Android, configurá la URL del servidor (IP/dominio público) en **Mapero → menú (⋮) → Servidor**.

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Crea usuario (`{username, password}`) → `{token, username}`. |
| `POST` | `/api/auth/login` | — | Inicia sesión → `{token, username}`. 10 intentos por IP+usuario cada 15 min. |
| `POST` | `/api/auth/logout` | `Bearer` | Cierra la sesión del token. |
| `GET` | `/api/auth/policy` | — | Mínimo de contraseña del servidor. |
| `POST` | `/api/measurements` | `Bearer` | Ingresa mediciones. Emite broadcast por WS. Idempotente: una medición repetida se ignosa y vuelve en `duplicates`. |
| `GET` | `/api/networks` | — | Redes agregadas (carga inicial de la web). Admite filtros, ver abajo. |
| `GET` | `/api/users` | — | Lista de usuarios para el filtro del mapa. |
| `GET` | `/api/territories` | — | Hexágonos (H3) conquistados y su dueño. |
| `GET` | `/api/leaderboard` | — | Ranking de conquistas por jugador. |
| `GET` | `/api/config` | — | Configuración que descargan las apps (intervalo, calibración, territorio). |
| `PUT` | `/api/config` | admin | Edita la configuración del sistema. |
| `GET` | `/api/admin/stats` | admin | Estadísticas del sistema. |
| `GET/PUT/DELETE` | `/api/admin/users[/:id]` | admin | Gestión de usuarios (rol, borrado). |
| `GET/DELETE` | `/api/admin/measurements` | admin | Listar / borrar mediciones. |
| `GET` | `/api/admin/settings` | admin | Configuración actual. |
| `GET` | `/api/last-position` | — | Última posición medida (centrado inicial). |
| `GET` | `/health` | — | Estado. |
| `WS` | `/ws` | opcional | Con `?token=...` emite las mediciones en vivo. Sin token solo emite `{type:"ingest", count}`, un aviso para recargar los agregados públicos. |

### Deduplicación

Una medición se identifica por `(user_id, bssid, ts)` y hay un índice único que
lo garantiza. La app manda lotes de a 100 y un mismo lote puede reenviarse (por
ejemplo si la subida se corta a mitad), así que la ingesta es idempotente:
`ON CONFLICT DO NOTHING` y la respuesta distingue `inserted` de `duplicates`.

El índice se crea en el arranque, después de borrar las copias que ya existieran
de instalaciones anteriores, por eso no está en el bloque de `CREATE TABLE`: con
duplicados presentes esa sentencia abortaría todo el arranque.

### Ejemplo de ingesta
```bash
curl -X POST http://localhost:8080/api/measurements \
  -H "Content-Type: application/json" \
  -H "x-api-key: mapero_dev_key" \
  -d '{"measurements":[
        {"bssid":"aa:bb:cc:00:11:22","ssid":"MiRed","latitude":-34.61,"longitude":-58.41,"rssi":-50,"frequency":2412,"timestamp":1700000000000}
      ]}'
```

## Filtros de red

`/api/networks` y `/api/admin/measurements` comparten los mismos parámetros
(`server/src/filters.js`):

| Parámetro | Valores | Efecto |
|---|---|---|
| `type` | `open` · `protected` · `unknown` | Seguridad de la red. |
| `band` | `2.4` · `5` · `6` | Banda (6 GHz = WiFi 6E). |
| `sig` | número | Señal mínima en dBm (ej. `-70`). |
| `user` | nombre de usuario | Solo redes medidas por ese usuario (en `/api/networks`, el de las mediciones de esa red). |
| `q` | texto | Coincidencia parcial del nombre de la red. |

`type=unknown` existe porque las mediciones anteriores a la columna
`capabilities` no se pueden clasificar: no son redes abiertas, son redes sin
datos de seguridad. Lo mismo pasa con `band` cuando la frecuencia es 0.

`/api/networks` agrega primero y filtra después (los filtros de `type`, `band`
y `sig` van en `HAVING`), así que los valores devueltos describen la red
completa. `/api/admin/measurements` lista mediciones individuales, ahí los
m filtros van por fila.

Un valor no reconocido se ignora en lugar de romper la consulta.

## Web en tiempo real
Abrir `http://localhost:8080` en el navegador. La página:
- Carga las redes iniciales desde `/api/networks`.
- Permite compartir filtros en la URL (`type`, `band`, `sig`, `user`, `q`) y los aplica también del lado servidor.
- Se conecta a `/ws` y, ante cada ingesta, reconcilia por HTTP las redes, los territorios y el leaderboard. Sin sesión recibe un aviso sin datos; con sesión, el flujo crudo.
- Muestra la **fecha de la última actualización** y el conteo de redes.

## Autenticación
Registro/Login por usuario (hash **bcrypt**, 10 rondas) que devuelve un **token de sesión** válido por 30 días. Las peticiones de escritura llevan `Authorization: Bearer <token>`. La identidad del jugador es su **usuario**, y a él se atribuyen las mediciones, la conquista y el leaderboard.

- Contraseña mínima de **8 caracteres** (se publica en `GET /api/auth/policy`).
- Cambiar la contraseña cierra las sesiones abiertas de ese usuario.
- `POST /api/auth/logout` revoca el token.

### ADMIN_USER

La variable de entorno nombra al primer administrador, pero **solo se aplica si la
base todavía no tiene ningún admin**. Sin esa condición, cualquiera que se
registrara con ese nombre quedaría con el rol en el reinicio siguiente. Si ya
hay un admin, `ADMIN_USER` se ignora y queda registrado en el log.

### CORS

Por defecto el servidor **no** permite orígenes externos: el front se sirve
desde el mismo backend, así que no hace falta. Si la web vive en otro dominio,
definí `CORS_ORIGIN=https://tu-dominio.example` (admite una lista separada por
comas).

## Juego de conquista
La web y la app muestran territorios (hexágonos H3 de ~150 m) coloreados por su dueño. La posesión se calcula con **cobertura + decaimiento**: cada medición suma un peso que decae exponencialmente (~7 días); el dueño de un hexágono es el jugador con más cobertura acumulada. La identidad es el **usuario** autenticado.

**Anti-cheat:** la ingesta rechaza mediciones con velocidad imposible (>40 m/s ≈ 144 km/h) entre lecturas del mismo usuario (detecta teletransportes).

**Defensa:** `GET /api/territories` devuelve también el **segundo** mejor score por celda y marca `contested` cuando supera el umbral `contest_threshold` (60% por defecto) del dueño — la web lo pinta con borde punteado como celda "en disputa".

**Configuración de la partida:** la resolución del hexágono (`hex_res`, 0–15), el decaimiento (`decay_days`) y el umbral de disputa (`contest_threshold`) se editan en el panel admin y **sí se aplican**: se leen de `settings` con validación de rango, y un cambio recalcula los donos. La app Android solo consume el intervalo de escaneo y la calibración.

## App Android
La app sube cada barrido a `{serverUrl}/api/measurements`. Configurar la URL y la API key desde **Mapero → menú (⋮) → Servidor**. Para desarrollo en la misma red local, la URL del servidor es la IP LAN de la máquina (p. ej. `http://192.168.0.12:8080`).

El envío se controla con el botón **"Streaming: ON/OFF"** de la app: con ON, cada barrido se sube en tiempo real; con OFF, los datos quedan solo en el dispositivo.

## Tests

```bash
cd server
npm test        # 45 pruebas de la lógica pura (sin base de datos)
npm run check   # sintaxis de los 9 archivos JS
```

Cubren la agregación de territories (decaimiento, dominio, disputa, límites de los
ajustes), el filtrado de redes (los cuatro filtros y sus combinaciones, y que un
parámetro no reconocido se ignore en vez de vaciar la respuesta) y la caché con
TTL (incluida la coalescencia de pedidos concurrentes y qué pasa cuando la
consulta falla).

```bash
cd android
./gradlew :app:testDebugUnitTest    # 34 pruebas, sin emulador
```

Corren en la JVM, sin emulador. `./gradlew :app:connectedDebugAndroidTest`
ejecuta las pruebas instrumentadas, que necesitan un dispositivo conectado.

Las migraciones de Room se verifican con `MigrationTestHelper` sobre
**Robolectric**, así que también corren en la JVM y en CI. La migración 2 -> 4
reconstruye la tabla completa: si algo sale mal, el usuario pierde todo lo que
tenía mapeado, y antes eso solo se descubría instalando la app.

CI (`.github/workflows/ci.yml`) corre los dos grupos en cada push.

### Migraciones de Room

El esquema se versiona en `android/app/schemas/`: `1.json`, `2.json` y `4.json`.

Los históricos **no se escribieron a mano**: `1.json` y `2.json` se generaron con
el propio Room compilando el código de esas versiones (`exportSchema = true` en
un worktree del commit correspondiente), así que describen la tabla tal como
quedaba de verdad.

El directorio se suma a los assets del variant principal porque los tests
unitarios leen los assets de la app, no los del source set `test`. Son unos 8 KB
en el APK.

Para una versión nueva: subir `@Database(version = n)`, escribir la migración,
dejar que el build genere `n.json`, y agregar el test. Room valida el esquema
resultante contra `n.json`, así que una columna, un índice o un tipo que no
coincidan hacen fallar el test en vez de romper en el dispositivo.
