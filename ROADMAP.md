# Roadmap · Mapero

Funcionalidades previstas para el futuro, ordenadas por temática. Nada de esto está implementado aún; es una guía de trabajo.

## 1. Mapa web en tiempo real
- Subir en tiempo real los datos (redes + posición + señal) desde la app a un servidor.
- Un sitio web donde se visualicen en vivo las redes y sus datos sobre un mapa (tiles + marcadores, similar a la app).
- Actualización push/streaming (WebSocket o similar) para no depender de recargas manuales.

### Consideraciones
- Modelo de datos a sincronizar: mismos campos que `measurements` + identificador de dispositivo/usuario.
- Manejar privacidad y autenticación antes de exponer datos públicos.
- Política de uso razonable del backend (límites de requests).

## 2. API para subir y compartir datos en tiempo real entre dispositivos
- Endpoint(s) REST (o gRPC/WebSocket) para:
  - **Ingesta**: `POST /measurements` desde cada dispositivo.
  - **Consulta**: `GET /networks` / `GET /networks/{id}` para leer datos de otros usuarios.
  - **Sincronización incremental**: enviar solo mediciones nuevas (timestamp/offset).
- Permite que varios dispositivos **colaboren** mapeando la misma zona en tiempo real.

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

## 4. Juego de conquista de zonas (modo competitivo)
- Dividir el mapa en **zonas/celdas** (cuadrícula o celdas hexagonales).
- Cada usuario/equipo "conquista" una celda al aportar **más cobertura** (señal, cantidad de redes detectadas) que otros.
- Puntuación y ranking entre personas para competir.
- Reutiliza los datos ya recopilados (redes + señal + posición).

### Consideraciones
- Definir métrica de "conquista" (p. ej. redes únicas por celda, intensidad acumulada, tiempo).
- Resolución de conflictos cuando dos personas mapean la misma zona.
- Anti-cheat / validación de datos (depende de la autenticación del punto 2).
- Requiere el backend de los puntos 1 y 2 para que la competencia sea entre dispositivos.

---

## 5. Filtros de tipos de red
- Filtrar las redes que se muestran en el mapa según su tipo/seguridad:
  - **Abiertas / sin autenticación / libres** (sin cifrado).
  - **Protegidas** (WPA/WPA2/WPA3, etc.).
  - Por banda o frecuencia (2,4 GHz / 5 GHz).
  - Por intensidad de señal mínima.
- El filtro se combina con el filtrado por zoom ya existente.

### Consideraciones
- Determinar el tipo de red a partir de `ScanResult` (capabilities: `[WPA*]`, `[WEP]`, sin flags = abierta).
- Hoy la entidad `measurements` no guarda las `capabilities`; habría que añadir el campo y migrar la base (nuevo `version` de Room).
- Aplicar el filtro en la agregación/UI, no solo al renderizar, para que también afecte exportaciones y conteos.

## 6. Búsqueda de redes por nombre
- Campo de búsqueda donde se escribe el **nombre (SSID)** de una red.
- Al elegir/confirmar, la cámara se mueve **directamente al punto** del mapa donde está esa red (desplaza y hace zoom, muestra su marcador e info).
- Autocompletado a partir de los SSID ya guardados.

### Consideraciones
- Buscar en los SSID de `lastSummaries` (pueden repetirse si hay varias con el mismo nombre en distinta zona; mostrar la lista para elegir).
- Al localizar, centrar el mapa en el marcador correspondiente (reutiliza la lógica de `setCenter`/`animateTo`) y opcionalmente abrir su burbuja de información.
- Puede funcionar 100 % local, sin depender del backend.

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
```

> Sugerencia de orden: primero la **API (2)**, porque habilita el mapa web (1) y la conquista (4). La fecha de actualización (3) puede hacerse de forma independiente y antes, por ser puramente local. Los **filtros (5)** y la **búsqueda (6)** también son independientes y solo requieren cambios en la app.
