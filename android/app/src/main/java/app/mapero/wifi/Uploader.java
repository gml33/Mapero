package app.mapero.wifi;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.mapero.wifi.data.AppDatabase;
import app.mapero.wifi.data.WifiMeasurement;

import java.util.ArrayList;

/**
 * Sube las mediciones al servidor Mapero.
 * Usa HttpURLConnection (sin dependencias externas) y una cola propia.
 *
 * El cursor de subida es el id de la última fila que el servidor confirmó, y
 * lo avanzan tanto el streaming como el sync completo. Antes solo lo movía el
 * sync, así que cada vez que se abría la app se volvía a subir toda la
 * historia y el servidor terminaba con miles de copias de la misma medición.
 */
public class Uploader {

    private static final String TAG = "Uploader";
    /** Filas por viaje. Acota la memoria: la base entera nunca entra en juego. */
    private static final int PAGE = 200;
    /** Compartido entre instancias: la app crea un Uploader por escáner. */
    private static final Object CURSOR_LOCK = new Object();

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public Uploader(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Sube un lote de streaming y avanza el cursor si el servidor lo aceptó. */
    public void enqueue(final List<WifiMeasurement> batch) {
        if (batch == null || batch.isEmpty()) return;
        executor.execute(() -> {
            try {
                if (send(batch)) {
                    // Con lo que se intentó, no con lo que el servidor devolvió:
                    // las filas repetidas se ignoran y no vuelven en el RETURNING,
                    // así que con ellas el cursor nunca avanzaría.
                    advanceCursor(maxId(batch));
                }
            } catch (Exception e) {
                Log.w(TAG, "fallo al subir: " + e.getMessage());
            }
        });
    }

    /**
     * Sube todo lo pendiente, de a páginas, y avanza el cursor al confirmar cada
     * una. Si una página falla, se detiene: el cursor queda donde estaba y el
     * siguiente intento retoma desde ahí.
     */
    public void syncAll() {
        executor.execute(() -> {
            try {
                ServerConfig config = ServerConfig.load(context);
                if (!config.hasToken()) return;

                AppDatabase db = AppDatabase.getInstance(context);
                long cursor = cursorInicial(db, config);
                int enviadas = 0;
                int paginas = 0;

                while (true) {
                    List<WifiMeasurement> pagina = db.wifiDao().getSinceId(cursor, PAGE);
                    if (pagina.isEmpty()) break;

                    if (!send(new ArrayList<>(pagina))) break;

                    long nuevoCursor = pagina.get(pagina.size() - 1).id;
                    advanceCursor(nuevoCursor);
                    cursor = nuevoCursor;
                    enviadas += pagina.size();
                    paginas++;
                    if (pagina.size() < PAGE) break;
                }

                if (enviadas > 0) {
                    Log.d(TAG, "sync: " + enviadas + " pendientes en " + paginas + " pagina(s)");
                }
            } catch (Exception e) {
                Log.w(TAG, "sync falló: " + e.getMessage());
            }
        });
    }

    /**
     * Cursor desde el que arrancar.
     *
     * La primera vez después de la actualización el cursor guardado es un
     * timestamp, no un id. Se traduce al id equivalente en vez de empezar de
     * cero, porque subir toda la historia de golpe es un golpe de CPU y además
     // haría recorrer el anti-cheat del servidor por posiciones viejas.
     */
    private long cursorInicial(AppDatabase db, ServerConfig config) {
        if (config.lastUploadedId > 0) return config.lastUploadedId;
        if (config.lastUploaded <= 0) return 0L;

        Long primero = db.wifiDao().firstIdAfterTimestamp(config.lastUploaded);
        long cursor = primero == null ? 0L : primero - 1;
        Log.d(TAG, "cursor viejo (timestamp " + config.lastUploaded
                + ") traducido a id " + cursor);
        return cursor;
    }

    private static long maxId(List<WifiMeasurement> batch) {
        long max = 0;
        for (WifiMeasurement m : batch) {
            if (m.id > max) max = m.id;
        }
        return max;
    }

    /** Nunca retrocede, y seguro entre las dos instancias de Uploader. */
    private void advanceCursor(long id) {
        if (id <= 0) return;
        synchronized (CURSOR_LOCK) {
            ServerConfig c = ServerConfig.load(context);
            if (id <= c.lastUploadedId) return;
            c.lastUploadedId = id;
            c.save(context);
        }
    }

    /** @return true si el servidor aceptó el lote. */
    private boolean send(List<WifiMeasurement> batch) throws Exception {
        ServerConfig config = ServerConfig.load(context);
        if (config.serverUrl == null || config.serverUrl.isEmpty()) return false;
        if (!config.hasToken()) return false; // sin sesión no se puede subir

        JSONArray arr = new JSONArray();
        for (WifiMeasurement m : batch) {
            JSONObject o = new JSONObject();
            o.put("bssid", m.bssid);
            o.put("ssid", m.ssid == null ? "" : m.ssid);
            o.put("latitude", m.latitude);
            o.put("longitude", m.longitude);
            o.put("rssi", m.rssi);
            o.put("frequency", m.frequency);
            o.put("capabilities", m.capabilities == null ? "" : m.capabilities);
            o.put("timestamp", m.timestamp);
            arr.put(o);
        }

        JSONObject body = new JSONObject();
        body.put("measurements", arr);

        URL url = new URL(config.serverUrl + "/api/measurements");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + config.token);
            conn.setDoOutput(true);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, "subida rechazada: HTTP " + code);
                return false;
            }
            return true;
        } finally {
            conn.disconnect();
        }
    }
}
