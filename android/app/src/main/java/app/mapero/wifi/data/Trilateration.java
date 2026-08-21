package app.mapero.wifi.data;

import java.util.List;

/**
 * Trilateración de señales RSSI.
 *
 * Convierte cada intensidad a una distancia con el modelo de pérdida de
 * trayectoria log-distance y resuelve la posición que minimiza los errores de
 * distancia a todas las muestras mediante iteración de Gauss-Newton (mínimos
 * cuadrados ponderados). Con pocas muestras, cae a un centroide ponderado.
 */
public final class Trilateration {

    private static final double M_PER_DEG_LAT = 111320.0;
    private static final int MAX_ITER = 10;
    private static final double EPS = 0.1; // metros

    private Trilateration() {
    }

    /** Distancia en metros estimada a partir del RSSI (dBm) y el modelo. */
    public static double distanceFromRssi(double rssi, double txPower, double pathLossN) {
        return Math.pow(10, (txPower - rssi) / (10 * pathLossN));
    }

    /**
     * Estima la posición {lat, lon} del origen de la señal.
     * Devuelve null si no hay suficientes muestras.
     */
    public static double[] estimate(List<WifiMeasurement> samples,
                                    double txPower, double pathLossN) {
        if (samples == null || samples.size() < 2) return null;

        double latRef = 0, lonRef = 0;
        for (WifiMeasurement m : samples) {
            latRef += m.latitude;
            lonRef += m.longitude;
        }
        latRef /= samples.size();
        lonRef /= samples.size();
        double cosLat = Math.cos(Math.toRadians(latRef));

        int n = samples.size();
        double[] x = new double[n];
        double[] y = new double[n];
        double[] d = new double[n];
        for (int i = 0; i < n; i++) {
            WifiMeasurement m = samples.get(i);
            x[i] = (m.longitude - lonRef) * M_PER_DEG_LAT * cosLat;
            y[i] = (m.latitude - latRef) * M_PER_DEG_LAT;
            d[i] = Math.max(distanceFromRssi(m.rssi, txPower, pathLossN), 1.0);
        }

        // Estimación inicial: centroide ponderado por 1/distancia^2.
        double sx = 0, sy = 0, sw = 0;
        for (int i = 0; i < n; i++) {
            double w = 1.0 / (d[i] * d[i] + 1);
            sx += x[i] * w;
            sy += y[i] * w;
            sw += w;
        }
        double px = sx / sw, py = sy / sw;

        // Gauss-Newton para n >= 3.
        if (n >= 3) {
            for (int it = 0; it < MAX_ITER; it++) {
                double j11 = 0, j12 = 0, j22 = 0, b1 = 0, b2 = 0;
                for (int i = 0; i < n; i++) {
                    double dx = px - x[i];
                    double dy = py - y[i];
                    double r = Math.sqrt(dx * dx + dy * dy);
                    double g = r - d[i];
                    double invR = r > 1e-6 ? 1.0 / r : 0;
                    double ux = dx * invR, uy = dy * invR;
                    double w = 1.0 / (d[i] * d[i] + 1);
                    j11 += w * ux * ux;
                    j12 += w * ux * uy;
                    j22 += w * uy * uy;
                    b1 -= w * ux * g;
                    b2 -= w * uy * g;
                }
                double det = j11 * j22 - j12 * j12;
                if (Math.abs(det) < 1e-9) break;
                double dx = (b1 * j22 - b2 * j12) / det;
                double dy = (b2 * j11 - b1 * j12) / det;
                px += dx;
                py += dy;
                if (Math.hypot(dx, dy) < EPS) break;
            }
        }

        double lat = latRef + py / M_PER_DEG_LAT;
        double lon = lonRef + px / (M_PER_DEG_LAT * cosLat);
        return new double[]{lat, lon};
    }
}
