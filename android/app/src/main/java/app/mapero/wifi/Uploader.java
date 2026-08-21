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

import app.mapero.wifi.data.WifiMeasurement;

/**
 * Sube las mediciones al servidor Mapero en tiempo real.
 * Usa HttpURLConnection (sin dependencias externas) y una cola propia.
 */
public class Uploader {

    private static final String TAG = "Uploader";
    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public Uploader(Context context) {
        this.context = context.getApplicationContext();
    }

    public void enqueue(final List<WifiMeasurement> batch) {
        if (batch == null || batch.isEmpty()) return;
        executor.execute(() -> {
            try {
                send(batch);
            } catch (Exception e) {
                Log.w(TAG, "fallo al subir: " + e.getMessage());
            }
        });
    }

    private void send(List<WifiMeasurement> batch) throws Exception {
        ServerConfig config = ServerConfig.load(context);
        if (config.serverUrl == null || config.serverUrl.isEmpty()) return;

        JSONArray arr = new JSONArray();
        for (WifiMeasurement m : batch) {
            JSONObject o = new JSONObject();
            o.put("bssid", m.bssid);
            o.put("ssid", m.ssid == null ? "" : m.ssid);
            o.put("latitude", m.latitude);
            o.put("longitude", m.longitude);
            o.put("rssi", m.rssi);
            o.put("frequency", m.frequency);
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
            conn.setReadTimeout(5000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("x-api-key", config.apiKey);
            if (config.playerName != null && !config.playerName.isEmpty()) {
                conn.setRequestProperty("x-device-name", config.playerName);
            }
            conn.setDoOutput(true);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }
            int code = conn.getResponseCode();
            Log.d(TAG, "subidos " + batch.size() + " mediciones -> HTTP " + code);
        } finally {
            conn.disconnect();
        }
    }
}
