package com.marcelo.wifimapper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import com.marcelo.wifimapper.scan.WifiScanner;
import com.marcelo.wifimapper.scan.WifiScannerHolder;

/**
 * Servicio en primer plano que mantiene el escaneo WiFi activo con la pantalla
 * apagada o usando otras apps. La notificación permite volver al mapa.
 */
public class ScanService extends Service implements WifiScanner.Listener {

    private static final String CHANNEL_ID = "scan";
    private static final int NOTIF_ID = 1;
    public static final String ACTION_START = "com.marcelo.wifimapper.action.START";
    public static final String ACTION_STOP = "com.marcelo.wifimapper.action.STOP";

    private WifiScanner scanner;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopScanning();
            return START_NOT_STICKY;
        }

        // START
        scanner = WifiScannerHolder.get(this);
        scanner.start(this);
        startAsForeground();
        return START_STICKY;
    }

    private void startAsForeground() {
        Notification notification = buildNotification("Escaneando WiFi…", 0);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private void stopScanning() {
        if (scanner != null) {
            scanner.stop();
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private Notification buildNotification(String text, int apCount) {
        Intent tapIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(apCount > 0 ? text + " · " + apCount + " AP" : text)
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(contentIntent)
                .build();
    }

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel channel =
                new NotificationChannel(CHANNEL_ID, "Escaneo WiFi", NotificationManager.IMPORTANCE_LOW);
        nm.createNotificationChannel(channel);
    }

    @Override
    public void onScanDone(int apCount) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIF_ID, buildNotification("Escaneando WiFi…", apCount));
    }

    @Override
    public void onError(String message) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIF_ID, buildNotification(message, 0));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
