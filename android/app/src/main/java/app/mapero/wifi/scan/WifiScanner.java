package app.mapero.wifi.scan;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.ContextCompat;

import app.mapero.wifi.Uploader;
import app.mapero.wifi.data.AppDatabase;
import app.mapero.wifi.data.WifiMeasurement;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Se encarga de pedir escaneos WiFi en bucle, recibir los resultados y
 * guardarlos junto con las coordenadas GPS actuales.
 */
public class WifiScanner {

    private static final String TAG = "WifiScanner";
    private static final long MIN_SCAN_INTERVAL_MS = 3500;  // rápido
    private static final long MAX_SCAN_INTERVAL_MS = 15000; // parado

    public interface Listener {
        void onScanDone(int apCount);
        void onError(String message);
    }

    private final Context context;
    private final WifiManager wifiManager;
    private final AppDatabase database;
    private final Uploader uploader;
    private final ExecutorService dbExecutor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private LocationHelper locationHelper;
    private final List<Listener> listeners = new ArrayList<>();
    private volatile boolean running = false;
    private int lastApCount = 0;

    // Filtro de suavizado RSSI (media móvil exponencial por BSSID)
    private static final double RssiALPHA = 0.5;
    private static final int RSSI_MAX_JUMP = 30; // descarta saltos de señal inviables (>30 dBm)
    private final Map<String, Integer> smoothedRssi = new HashMap<>();

    private final Runnable scanLoop = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            requestScan();
            handler.postDelayed(this, computeIntervalMs());
        }
    };

    private final BroadcastReceiver scanResultsReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (!running) return;
            if (WifiManager.SCAN_RESULTS_AVAILABLE_ACTION.equals(intent.getAction())) {
                handleScanResults();
            }
        }
    };

    public WifiScanner(Context context) {
        this.context = context.getApplicationContext();
        this.wifiManager = (WifiManager) context.getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        this.database = AppDatabase.getInstance(context);
        this.uploader = new Uploader(this.context);
        this.locationHelper = new LocationHelper(this.context);
    }

    public void addListener(Listener l) {
        if (l != null && !listeners.contains(l)) {
            listeners.add(l);
        }
    }

    public void removeListener(Listener l) {
        listeners.remove(l);
    }

    public void start(Listener l) {
        addListener(l);
        if (wifiManager == null) {
            notifyError("Este dispositivo no tiene WiFi");
            return;
        }
        if (!wifiManager.isWifiEnabled()) {
            notifyError("Habilita el WiFi para escanear");
            return;
        }
        if (!hasLocationPermission()) {
            notifyError("Falta permiso de ubicación");
            return;
        }
        running = true;

        locationHelper.start(location -> {
            Log.d(TAG, "GPS actualizado: " + location.getLatitude() + "," + location.getLongitude());
        });

        IntentFilter filter = new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION);
        ContextCompat.registerReceiver(context, scanResultsReceiver, filter,
                ContextCompat.RECEIVER_EXPORTED);

        requestScan();
        handler.postDelayed(scanLoop, computeIntervalMs());
    }

    /**
     * Intervalo entre escaneos según la velocidad de movimiento: a mayor
     * velocidad, más escaneos por minuto (y viceversa al estar parado).
     */
    private long computeIntervalMs() {
        float speed = locationHelper.getSpeed();
        long interval;
        if (speed < 0.8f) {
            interval = 12000;   // parado / muy lento
        } else if (speed < 1.5f) {
            interval = 8000;    // paso lento
        } else if (speed < 2.5f) {
            interval = 6000;    // caminata normal
        } else {
            interval = 3500;    // rápido / corriendo
        }
        return Math.max(MIN_SCAN_INTERVAL_MS, Math.min(MAX_SCAN_INTERVAL_MS, interval));
    }

    @SuppressLint("MissingPermission")
    private void requestScan() {
        if (!hasScanPermission()) {
            notifyError("Falta permiso para escanear WiFi");
            return;
        }
        if (!wifiManager.startScan()) {
            Log.w(TAG, "startScan() devolvió false; posible límite de escaneos");
        }
    }

    private void handleScanResults() {
        List<ScanResult> results;
        try {
            results = wifiManager.getScanResults();
        } catch (SecurityException e) {
            notifyError("Sin permiso para leer resultados WiFi");
            return;
        }

        Location loc = locationHelper.getLastLocation();
        lastApCount = results == null ? 0 : results.size();

        final List<WifiMeasurement> batch = new ArrayList<>();
        if (results != null && loc != null) {
            for (ScanResult r : results) {
                String bssid = r.BSSID == null ? "unknown" : r.BSSID;
                WifiMeasurement m = new WifiMeasurement();
                m.bssid = bssid;
                m.ssid = r.SSID == null ? "" : r.SSID;
                m.latitude = loc.getLatitude();
                m.longitude = loc.getLongitude();
                m.rssi = smoothRssi(bssid, r.level);
                m.frequency = r.frequency;
                m.timestamp = System.currentTimeMillis();
                batch.add(m);
            }
        }

        final int count = lastApCount;
        notifyScanDone(count);

        if (!batch.isEmpty()) {
            dbExecutor.execute(() -> {
                try {
                    database.wifiDao().insertAll(batch);
                    Log.d(TAG, "Guardados " + batch.size() + " AP");
                } catch (Exception e) {
                    Log.e(TAG, "Error guardando", e);
                }
            });
            // Sube el mismo lote al servidor en tiempo real.
            uploader.enqueue(batch);
        }
    }

    public boolean isRunning() {
        return running;
    }

    public void stop() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        try {
            context.unregisterReceiver(scanResultsReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        locationHelper.stop();
    }

    private int smoothRssi(String bssid, int raw) {
        Integer prev = smoothedRssi.get(bssid);
        if (prev == null) {
            smoothedRssi.put(bssid, raw);
            return raw;
        }
        // Descarta lecturas inviables (cambios bruscos que casi seguro son ruido).
        if (Math.abs(raw - prev) > RSSI_MAX_JUMP) {
            return prev;
        }
        int smoothed = (int) Math.round(RssiALPHA * raw + (1 - RssiALPHA) * prev);
        smoothedRssi.put(bssid, smoothed);
        return smoothed;
    }

    private boolean hasScanPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(context,
                    Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(context,
                Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(context,
                Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void notifyScanDone(int apCount) {
        for (Listener l : listeners) {
            l.onScanDone(apCount);
        }
    }

    private void notifyError(String message) {
        for (Listener l : listeners) {
            l.onError(message);
        }
    }
}
