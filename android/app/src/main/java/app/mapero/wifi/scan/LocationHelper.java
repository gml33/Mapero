package app.mapero.wifi.scan;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

/**
 * Entrega la última posición GPS conocida y actualiza periódicamente mientras
 * se camina. Usa LocationManager sin dependencias extra.
 */
public class LocationHelper {

    public interface Callback {
        void onLocationChanged(Location location);
    }

    private final LocationManager locationManager;
    private final Context context;
    private Callback callback;
    private Location lastLocation;
    private long lastFixTime = 0;
    private float lastSpeed = 0f; // m/s
    private boolean registered = false;
    private LocationListener listener;
    private static final long MIN_TIME_MS = 2000;   // intervalo de refresco GPS
    private static final float MIN_DISTANCE_M = 1.0f; // distancia mínima

    public LocationHelper(Context context) {
        this.context = context;
        this.locationManager =
                (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        this.listener = createListener();
    }

    public void start(Callback cb) {
        if (cb != null) {
            this.callback = cb;
        }
        if (!hasPermission()) {
            return;
        }
        lastLocation = pickBestLocation();
        if (lastLocation != null && cb != null) {
            cb.onLocationChanged(lastLocation);
        }
        if (registered) {
            return;
        }

        try {
            locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    MIN_TIME_MS, MIN_DISTANCE_M, listener, Looper.getMainLooper());
            registered = true;
        } catch (SecurityException | IllegalArgumentException ignored) {
        }
    }

    private LocationListener createListener() {
        return new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                Location previous = lastLocation;
                lastLocation = location;
                lastFixTime = System.currentTimeMillis();
                if (previous != null) {
                    float dist = previous.distanceTo(location); // metros
                    long dt = location.getTime() - previous.getTime(); // ms
                    lastSpeed = dt > 0 ? (dist * 1000f) / dt : 0f; // m/s
                } else {
                    lastSpeed = 0f;
                }
                if (callback != null) {
                    callback.onLocationChanged(location);
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
            }

            @Override
            public void onProviderEnabled(@NonNull String provider) {
            }

            @Override
            public void onProviderDisabled(@NonNull String provider) {
            }
        };
    }

    public void stop() {
        // Conserva el callback; solo detiene las actualizaciones GPS.
        if (registered) {
            locationManager.removeUpdates(listener);
            registered = false;
        }
    }

    @SuppressLint("MissingPermission")
    private Location pickBestLocation() {
        if (!hasPermission()) return null;
        Location gps = null, net = null;
        try {
            gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            net = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
        } catch (SecurityException ignored) {
        }
        long now = System.currentTimeMillis();
        if (gps != null && net != null) {
            return gps.getTime() > net.getTime() ? gps : net;
        }
        if (gps != null && (now - gps.getTime()) < 60_000) return gps;
        return net;
    }

    public Location getLastLocation() {
        return lastLocation;
    }

    /** Velocidad actual en m/s (0 si aún no hay dos fijaciones). */
    public float getSpeed() {
        return lastSpeed;
    }

    public long getLastFixAgoMs() {
        return lastLocation == null ? Long.MAX_VALUE : System.currentTimeMillis() - lastFixTime;
    }

    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }
}
