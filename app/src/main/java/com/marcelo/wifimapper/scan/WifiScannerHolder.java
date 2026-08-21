package com.marcelo.wifimapper.scan;

import android.content.Context;

/**
 * Mantiene una única instancia del escáner compartida entre la Activity y el
 * servicio en primer plano, para que el escaneo no dependa del ciclo de vida
 * de la interfaz.
 */
public final class WifiScannerHolder {

    private static WifiScanner instance;

    private WifiScannerHolder() {
    }

    public static synchronized WifiScanner get(Context context) {
        if (instance == null) {
            instance = new WifiScanner(context.getApplicationContext());
        }
        return instance;
    }
}
