package app.mapero.wifi;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.view.GestureDetector;
import android.view.Menu;
import android.view.MenuItem;
import android.view.MotionEvent;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.lifecycle.Observer;

import com.google.android.material.button.MaterialButton;
import app.mapero.wifi.data.AppDatabase;
import app.mapero.wifi.data.WifiApSummary;
import app.mapero.wifi.data.WifiMeasurement;
import app.mapero.wifi.data.SignalAggregator;
import app.mapero.wifi.export.Exporter;
import app.mapero.wifi.overlays.PulseOverlay;
import app.mapero.wifi.overlays.WifiInfoWindow;
import app.mapero.wifi.scan.LocationHelper;
import app.mapero.wifi.scan.WifiScanner;
import app.mapero.wifi.scan.WifiScannerHolder;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.osmdroid.config.Configuration;
import org.osmdroid.events.MapListener;
import org.osmdroid.events.ScrollEvent;
import org.osmdroid.events.ZoomEvent;
import org.osmdroid.util.GeoPoint;
import org.osmdroid.views.MapView;
import org.osmdroid.views.overlay.Marker;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends AppCompatActivity implements WifiScanner.Listener {

    private static final String TAG = "MainActivity";
    private static final int REQ_PERMISSIONS = 100;

    private MapView mapView;
    private TextView statusText;
    private MaterialButton scanButton;
    private MaterialButton followButton;
    private MaterialButton streamButton;

    private AppDatabase database;
    private WifiScanner scanner;
    private LocationHelper follower;
    private boolean scanning = false;
    private boolean followMode = false;
    private boolean initialCentered = false;

    private final java.util.Map<String, Marker> markerByBssid = new java.util.HashMap<>();
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();

    private Calibration calibration;
    private java.util.List<WifiMeasurement> lastData;
    private java.util.List<WifiApSummary> lastSummaries;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configuración OSMDroid
        Configuration.getInstance().setUserAgentValue(getPackageName());
        Configuration.getInstance().load(
                getApplicationContext(),
                PreferenceManager.getDefaultSharedPreferences(getApplicationContext()));

        setContentView(R.layout.activity_main);

        mapView = findViewById(R.id.map);
        statusText = findViewById(R.id.statusText);
        scanButton = findViewById(R.id.scanButton);
        followButton = findViewById(R.id.followButton);
        streamButton = findViewById(R.id.streamButton);

        mapView.setMultiTouchControls(true);
        mapView.setUseDataConnection(true);
        mapView.getController().setZoom(19.0);

        // Filtra los marcadores visibles según el nivel de zoom.
        mapView.setMapListener(new MapListener() {
            @Override
            public boolean onScroll(ScrollEvent event) {
                return false;
            }

            @Override
            public boolean onZoom(ZoomEvent event) {
                applyZoomFilter();
                return false;
            }
        });
        // Centra en Buenos Aires por defecto (se ajusta con el GPS)
        mapView.getController().setCenter(new GeoPoint(-34.6118, -58.4173));

        database = AppDatabase.getInstance(this);
        calibration = Calibration.load(this);
        scanner = WifiScannerHolder.get(this);
        follower = new LocationHelper(this);

        scanButton.setOnClickListener(v -> {
            if (scanning) {
                stopScanning();
            } else {
                startScanningIfPermitted();
            }
        });

        setupFollowUi();
        updateFollowButton();
        updateStreamButton();

        // Observa las mediciones, las agrega por trilateración y pinta los puntos
        Observer<List<WifiMeasurement>> observer = data -> {
            lastData = data;
            refreshMap();
        };
        database.wifiDao().observeAll().observe(this, observer);
    }

    @Override
    protected void onResume() {
        super.onResume();
        mapView.onResume();
        if (hasNeededPermissions()) {
            follower.start(null); // re-registra sin pisar el callback de centrado
        }
        // Sincroniza el estado del botón con el servicio en primer plano.
        scanning = scanner.isRunning();
        scanButton.setText(scanning ? R.string.stop : R.string.start);
        scanner.addListener(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        mapView.onPause();
        follower.stop();
        scanner.removeListener(this);
    }

    private void startScanningIfPermitted() {
        if (!hasNeededPermissions()) {
            requestNeededPermissions();
            return;
        }
        startScanning();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERMISSIONS) {
            if (hasNeededPermissions()) {
                startScanning();
            } else {
                Toast.makeText(this, "Permisos requeridos no concedidos", Toast.LENGTH_LONG).show();
            }
        }
    }

    private boolean hasNeededPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.NEARBY_WIFI_DEVICES)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            if (Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void requestNeededPermissions() {
        List<String> perms = new ArrayList<>();
        perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
        if (Build.VERSION.SDK_INT >= 33) {
            perms.add(Manifest.permission.NEARBY_WIFI_DEVICES);
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        ActivityCompat.requestPermissions(
                this, perms.toArray(new String[0]), REQ_PERMISSIONS);
    }

    private void startScanning() {
        scanning = true;
        scanButton.setText(R.string.stop);
        statusText.setText(R.string.stopped);
        Intent svc = new Intent(this, ScanService.class);
        svc.setAction(ScanService.ACTION_START);
        ContextCompat.startForegroundService(this, svc);
    }

    private void stopScanning() {
        scanning = false;
        scanButton.setText(R.string.start);
        statusText.setText(R.string.stopped);
        Intent svc = new Intent(this, ScanService.class);
        svc.setAction(ScanService.ACTION_STOP);
        startService(svc);
    }

    // ---- Seguimiento de posición GPS ----

    private void setupFollowUi() {
        streamButton.setOnClickListener(v -> {
            ServerConfig config = ServerConfig.load(this);
            config.streaming = !config.streaming;
            config.save(this);
            updateStreamButton();
        });

        followButton.setOnClickListener(v -> {
            followMode = !followMode;
            updateFollowButton();
        });

        // Cuando el usuario desliza el mapa, deja de seguir automáticamente.
        GestureDetector dragDetector = new GestureDetector(this,
                new GestureDetector.SimpleOnGestureListener() {
                    @Override
                    public boolean onScroll(MotionEvent e1, MotionEvent e2,
                                            float dX, float dY) {
                        if (followMode) {
                            followMode = false;
                            updateFollowButton();
                        }
                        return false;
                    }

                    @Override
                    public boolean onFling(MotionEvent e1, MotionEvent e2,
                                           float vX, float vY) {
                        if (followMode) {
                            followMode = false;
                            updateFollowButton();
                        }
                        return false;
                    }
                });

        mapView.setOnTouchListener((v, event) -> dragDetector.onTouchEvent(event));

        follower.start(location ->
                runOnUiThread(() -> {
                    if (!initialCentered) {
                        // Primera posición: centra el mapa y recién ahí activa el seguimiento.
                        mapView.getController().setCenter(new GeoPoint(
                                location.getLatitude(), location.getLongitude()));
                        initialCentered = true;
                        followMode = true;
                        updateFollowButton();
                    } else if (followMode) {
                        mapView.getController().animateTo(new GeoPoint(
                                location.getLatitude(), location.getLongitude()));
                    }
                }));
    }

    private void updateFollowButton() {
        followButton.setText(followMode ? R.string.follow_on : R.string.follow_off);
    }

    private void updateStreamButton() {
        boolean streaming = ServerConfig.load(this).streaming;
        streamButton.setText(streaming ? R.string.stream_on : R.string.stream_off);
    }

    // ---- WifiScanner.Listener ----

    @Override
    public void onScanDone(int apCount) {
        runOnUiThread(() -> {
            String msg = (scanning)
                    ? String.format(Locale.getDefault(), getString(R.string.scanning), apCount)
                    : getString(R.string.stopped);
            statusText.setText(msg);
        });
    }

    @Override
    public void onError(String message) {
        runOnUiThread(() -> {
            statusText.setText(message);
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        });
    }

    // ---- Renderizado del mapa ----

    private void refreshMap() {
        lastSummaries = SignalAggregator.aggregateByTrilateration(lastData,
                calibration.txPower, calibration.pathLossN);
        renderSummaries(lastSummaries);
        applyZoomFilter();
    }

    /**
     * En zonas con muchas redes muestra según el zoom: cuanto más lejos, menos
     * marcadores (priorizando los de mayor señal); al acercar, aparecen todos.
     */
    private void applyZoomFilter() {
        if (lastSummaries == null || lastSummaries.isEmpty()) return;

        double zoom = mapView.getZoomLevelDouble();
        int maxToShow = Math.min(lastSummaries.size(), countForZoom(zoom));

        // Ordena por señal descendente (más fuerte primero).
        java.util.List<WifiApSummary> sorted = new java.util.ArrayList<>(lastSummaries);
        sorted.sort((a, b) -> Double.compare(b.avgRssi, a.avgRssi));

        int shown = 0;
        for (WifiApSummary ap : sorted) {
            Marker marker = markerByBssid.get(ap.bssid);
            if (marker != null) {
                marker.setEnabled(shown < maxToShow);
            }
            shown++;
        }
        mapView.invalidate();
    }

    private int countForZoom(double zoom) {
        if (zoom >= 17) return 200;  // todas
        if (zoom >= 15) return 40;
        if (zoom >= 13) return 20;
        if (zoom >= 11) return 12;
        return 6;
    }

    private void renderSummaries(List<WifiApSummary> summaries) {
        if (summaries == null) return;

        java.util.Set<String> current = new java.util.HashSet<>();

        for (WifiApSummary ap : summaries) {
            current.add(ap.bssid);
            GeoPoint point = new GeoPoint(ap.avgLatitude, ap.avgLongitude);

            Marker marker = markerByBssid.get(ap.bssid);
            if (marker == null) {
                // Red nueva: crea el marcador y dispara un pulso suave.
                marker = new Marker(mapView);
                marker.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER);
                marker.setInfoWindow(new WifiInfoWindow(this, mapView));
                mapView.getOverlays().add(marker);
                markerByBssid.put(ap.bssid, marker);

                PulseOverlay pulse = new PulseOverlay(mapView, point,
                        ContextCompat.getColor(this, colorResForSignal(ap.avgRssi)));
                mapView.getOverlays().add(pulse);
                pulse.start();
            }

            marker.setPosition(point);
            marker.setIcon(ContextCompat.getDrawable(this, colorForSignal(ap.avgRssi)));
            marker.setTitle(nameFor(ap));
            marker.setSnippet(String.format(Locale.getDefault(),
                    "Señal: %.0f dBm  ·  Muestras: %d", ap.avgRssi, ap.samples));
        }

        // Elimina marcadores de redes que ya no existen (p. ej. tras borrar datos).
        java.util.Iterator<java.util.Map.Entry<String, Marker>> it =
                markerByBssid.entrySet().iterator();
        while (it.hasNext()) {
            java.util.Map.Entry<String, Marker> e = it.next();
            if (!current.contains(e.getKey())) {
                mapView.getOverlays().remove(e.getValue());
                it.remove();
            }
        }
        mapView.invalidate();
    }

    private int colorResForSignal(double rssi) {
        if (rssi >= -60) return R.color.signal_strong;
        if (rssi >= -75) return R.color.signal_good;
        return R.color.signal_weak;
    }

    private String nameFor(WifiApSummary ap) {
        if (ap.ssid != null && !ap.ssid.isEmpty()) return ap.ssid;
        return ap.bssid;
    }

    private int colorForSignal(double rssi) {
        if (rssi >= -60) return R.drawable.marker_strong;   // verde
        if (rssi >= -75) return R.drawable.marker_good;     // amarillo
        return R.drawable.marker_weak;                      // rojo
    }

    // ---- Menú y exportación ----

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_export_csv) {
            export(ExportType.CSV);
            return true;
        } else if (id == R.id.action_export_kml) {
            export(ExportType.KML);
            return true;
        } else if (id == R.id.action_clear) {
            ioExecutor.execute(() -> database.wifiDao().clearAll());
            return true;
        } else if (id == R.id.action_calibrate) {
            showCalibrationDialog();
            return true;
        } else if (id == R.id.action_server) {
            showServerDialog();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void showServerDialog() {
        ServerConfig config = ServerConfig.load(this);

        android.widget.EditText urlInput = new android.widget.EditText(this);
        urlInput.setHint("URL del servidor, ej. http://192.168.0.12:8080");
        urlInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        urlInput.setText(config.serverUrl);

        android.widget.EditText keyInput = new android.widget.EditText(this);
        keyInput.setHint("API key");
        keyInput.setText(config.apiKey);

        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, 0);
        layout.addView(urlInput);
        layout.addView(keyInput);

        new com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle("Servidor remoto")
                .setMessage("Dónde subir los datos para verlos en el mapa web en tiempo real.")
                .setView(layout)
                .setPositiveButton("Guardar", (d, w) -> {
                    ServerConfig c = new ServerConfig();
                    c.serverUrl = urlInput.getText().toString().trim();
                    c.apiKey = keyInput.getText().toString().trim();
                    c.save(this);
                    android.widget.Toast.makeText(this, "Servidor guardado", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    private void showCalibrationDialog() {
        android.widget.EditText txInput = new android.widget.EditText(this);
        txInput.setHint("Señal a 1 m (dBm), ej. -45");
        txInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER
                | android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
                | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        txInput.setText(String.valueOf(calibration.txPower));

        android.widget.EditText nInput = new android.widget.EditText(this);
        nInput.setHint("Exponente n (interiores ≈ 2.5)");
        nInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER
                | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        nInput.setText(String.valueOf(calibration.pathLossN));

        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, 0);
        layout.addView(txInput);
        layout.addView(nInput);

        new com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle("Calibración del modelo")
                .setMessage("Ajusta los parámetros de propagación para mejorar la trilateración.")
                .setView(layout)
                .setPositiveButton("Guardar", (d, w) -> {
                    calibration.txPower = parse(txInput.getText().toString(),
                            Calibration.DEFAULT_TX_POWER, -60, -30);
                    calibration.pathLossN = parse(nInput.getText().toString(),
                            Calibration.DEFAULT_PATH_LOSS_N, 1.5, 4.0);
                    calibration.save(this);
                    refreshMap();
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    private double parse(String text, double def, double min, double max) {
        try {
            double v = Double.parseDouble(text.trim());
            return Math.max(min, Math.min(max, v));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private enum ExportType { CSV, KML }

    private void export(ExportType type) {
        Toast.makeText(this, "Generando…", Toast.LENGTH_SHORT).show();
        ioExecutor.execute(() -> {
            try {
                java.util.List<WifiApSummary> aps =
                        SignalAggregator.aggregateByTrilateration(database.wifiDao().getAll(),
                                calibration.txPower, calibration.pathLossN);
                File dir = new File(getCacheDir(), "exports");
                if (!dir.exists()) {
                    dir.mkdirs();
                }
                File file = (type == ExportType.CSV)
                        ? Exporter.toCsv(dir, aps)
                        : Exporter.toKml(dir, aps);
                runOnUiThread(() -> share(file));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this,
                        "Error al exportar: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void share(File file) {
        Uri uri = FileProvider.getUriForFile(this,
                getPackageName() + ".fileprovider", file);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("application/octet-stream");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.setClipData(android.content.ClipData.newUri(
                getContentResolver(), file.getName(), uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(send, "Compartir " + file.getName()));
    }

    @Override
    protected void onDestroy() {
        // No se detiene el escáner aquí: lo gobierna el ScanService en primer plano.
        if (!scanner.isRunning()) {
            scanner.stop();
        }
        ioExecutor.shutdown();
        super.onDestroy();
    }
}
