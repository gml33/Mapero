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

## Ejecutar

```bash
npm start          # o: npm run dev (reinicia ante cambios)
```

Al arrancar crea automáticamente las tablas (`devices`, `measurements`).

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/measurements` | `x-api-key` | Ingresa mediciones (array o `{measurements:[...]}`). Emite broadcast por WS. |
| `GET` | `/api/networks` | — | Redes agregadas (para la carga inicial de la web). |
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

## App Android
La app sube cada barrido a `{serverUrl}/api/measurements`. Configurar la URL y la API key desde **Mapero → menú (⋮) → Servidor**. Para desarrollo en la misma red local, la URL del servidor es la IP LAN de la máquina (p. ej. `http://192.168.0.12:8080`).

El envío se controla con el botón **"Streaming: ON/OFF"** de la app: con ON, cada barrido se sube en tiempo real; con OFF, los datos quedan solo en el dispositivo.
