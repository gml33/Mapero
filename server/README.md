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
| `CORS_ORIGIN` | `*` | Origen permitido para CORS |

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
| `POST` | `/api/auth/login` | — | Inicia sesión → `{token, username}`. |
| `POST` | `/api/measurements` | `Bearer` | Ingresa mediciones del usuario autenticado. Emite broadcast por WS. |
| `GET` | `/api/networks` | — | Redes agregadas (carga inicial de la web). |
| `GET` | `/api/territories` | — | Hexágonos (H3) conquistados y su dueño. |
| `GET` | `/api/leaderboard` | — | Ranking de conquistas por jugador. |
| `GET` | `/api/last-position` | — | Última posición medida (centrado inicial). |
| `GET` | `/health` | — | Estado. |
| `WS` | `/ws` | — | Emite `{type:"measurements", data:[...]}` en tiempo real. |

### Ejemplo de ingesta
```bash
curl -X POST http://localhost:8080/api/measurements \
  -H "Content-Type: application/json" \
  -H "x-api-key: mapero_dev_key" \
  -d '{"measurements":[
        {"bssid":"aa:bb:cc:00:11:22","ssid":"MiRed","latitude":-34.61,"longitude":-58.41,"rssi":-50,"frequency":2412,"timestamp":1700000000000}
      ]}'
```

## Web en tiempo real
Abrir `http://localhost:8080` en el navegador. La página:
- Carga las redes iniciales desde `/api/networks`.
- Se conecta a `/ws` y pinta en vivo cada medición entrante (centroide ponderado por señal, coloreado por intensidad).
- Muestra la **fecha de la última actualización** y el conteo de redes.

## Autenticación
Registro/Login por usuario (hash **bcrypt**) que devuelve un **token de sesión**. Las peticiones de escritura llevan `Authorization: Bearer <token>`. La identidad del jugador es su **usuario**, y a él se atribuyen las mediciones, la conquista y el leaderboard.

## Juego de conquista
La web y la app muestran territorios (hexágonos H3 de ~150 m) coloreados por su dueño. La posesión se calcula con **cobertura + decaimiento**: cada medición suma un peso que decae exponencialmente (~7 días); el dueño de un hexágono es el jugador con más cobertura acumulada. La identidad es el **usuario** autenticado.

**Anti-cheat:** la ingesta rechaza mediciones con velocidad imposible (>40 m/s ≈ 144 km/h) entre lecturas del mismo usuario (detecta teletransportes).

**Defensa:** `GET /api/territories` devuelve también el **segundo** mejor score por celda y marca `contested` cuando supera el 60% del dueño — la web lo pinta con borde punteado como celda "en disputa".

## App Android
La app sube cada barrido a `{serverUrl}/api/measurements`. Configurar la URL y la API key desde **Mapero → menú (⋮) → Servidor**. Para desarrollo en la misma red local, la URL del servidor es la IP LAN de la máquina (p. ej. `http://192.168.0.12:8080`).

El envío se controla con el botón **"Streaming: ON/OFF"** de la app: con ON, cada barrido se sube en tiempo real; con OFF, los datos quedan solo en el dispositivo.
