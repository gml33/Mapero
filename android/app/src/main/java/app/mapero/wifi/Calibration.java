package app.mapero.wifi;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Parámetros del modelo de propagación para la trilateración.
 * - txPower: señal (dBm) esperada a 1 metro del punto de acceso.
 * - pathLossN: exponente de pérdida de trayectoria (interiores ≈ 2,5).
 */
public final class Calibration {

    public static final double DEFAULT_TX_POWER = -45.0;
    // n = 2.0 (espacio libre / exterior): mejor para mediciones en la calle.
    public static final double DEFAULT_PATH_LOSS_N = 2.0;

    private static final String PREFS = "calibration";
    private static final String KEY_TX = "txPower";
    private static final String KEY_N = "pathLossN";

    public double txPower;
    public double pathLossN;

    public Calibration() {
        txPower = DEFAULT_TX_POWER;
        pathLossN = DEFAULT_PATH_LOSS_N;
    }

    public static Calibration load(Context context) {
        Calibration c = new Calibration();
        SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        c.txPower = sp.getFloat(KEY_TX, (float) DEFAULT_TX_POWER);
        c.pathLossN = sp.getFloat(KEY_N, (float) DEFAULT_PATH_LOSS_N);
        return c;
    }

    public void save(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putFloat(KEY_TX, (float) txPower)
                .putFloat(KEY_N, (float) pathLossN)
                .apply();
    }
}
