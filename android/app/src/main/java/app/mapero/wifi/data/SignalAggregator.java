package app.mapero.wifi.data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Agrupa las mediciones por BSSID eligiendo como posición del punto de acceso
 * la muestra donde la señal fue más fuerte (mejor aproximación a la fuente),
 * y resume el RSSI con su promedio.
 */
public final class SignalAggregator {

    private SignalAggregator() {
    }

    public static List<WifiApSummary> aggregateByBestSignal(List<WifiMeasurement> measurements) {
        Map<String, Acc> accMap = new LinkedHashMap<>();
        if (measurements == null) return new ArrayList<>();

        for (WifiMeasurement m : measurements) {
            Acc acc = accMap.get(m.bssid);
            if (acc == null) {
                acc = new Acc();
                acc.best = m;
                acc.rssiSum = m.rssi;
                acc.count = 1;
                acc.ssid = m.ssid;
                accMap.put(m.bssid, acc);
            } else {
                acc.rssiSum += m.rssi;
                acc.count++;
                if (m.ssid != null && !m.ssid.isEmpty()) {
                    acc.ssid = m.ssid;
                }
                // Conserva la muestra con mayor señal (menos negativa).
                if (m.rssi > acc.best.rssi) {
                    acc.best = m;
                }
            }
        }

        List<WifiApSummary> out = new ArrayList<>(accMap.size());
        for (Acc acc : accMap.values()) {
            WifiApSummary s = new WifiApSummary();
            s.bssid = acc.best.bssid;
            s.ssid = acc.ssid;
            s.avgRssi = (double) acc.rssiSum / acc.count;
            s.avgLatitude = acc.best.latitude;
            s.avgLongitude = acc.best.longitude;
            s.samples = Math.toIntExact(acc.count);
            out.add(s);
        }
        return out;
    }

    /**
     * Estimación multiseñal de la posición del punto de acceso: agrupa por red
     * (SSID) y estima su origen mediante trilateración por mínimos cuadrados
     * (ver {@link Trilateration}). Con pocas muestras cae a un centroide
     * ponderado por intensidad.
     */
    public static List<WifiApSummary> aggregateByTrilateration(List<WifiMeasurement> measurements) {
        return aggregateByTrilateration(measurements, -45.0, 2.0);
    }

    public static List<WifiApSummary> aggregateByTrilateration(List<WifiMeasurement> measurements,
                                                               double txPower, double pathLossN) {
        Map<String, Acc> accMap = new LinkedHashMap<>();
        if (measurements == null) return new ArrayList<>();

        for (WifiMeasurement m : measurements) {
            // Agrupa por nombre de red (SSID) para fusionar todos sus puntos de
            // acceso; si el SSID no se conoce, usa el BSSID como clave.
            String key = groupKey(m.ssid, m.bssid);
            Acc acc = accMap.get(key);
            if (acc == null) {
                acc = new Acc();
                acc.bssid = m.bssid;
                acc.ssid = m.ssid;
                acc.samplesList = new ArrayList<>();
                accMap.put(key, acc);
            } else if (m.ssid != null && !m.ssid.isEmpty()) {
                acc.ssid = m.ssid;
            }
            acc.samplesList.add(m);
            acc.rssiSum += m.rssi;
            acc.count++;
            if (isOpenNetwork(m.capabilities)) {
                acc.openCount++;
            } else {
                acc.securedCount++;
            }
            if (m.frequency > 0) {
                if (m.frequency < 3000) acc.band24++;
                else acc.band5++;
            }
        }

        List<WifiApSummary> out = new ArrayList<>(accMap.size());
        for (Acc acc : accMap.values()) {
            WifiApSummary s = new WifiApSummary();
            s.bssid = acc.bssid;
            s.ssid = acc.ssid;
            s.avgRssi = acc.count == 0 ? 0 : (double) acc.rssiSum / acc.count;

            double[] pos = Trilateration.estimate(acc.samplesList, txPower, pathLossN);
            if (pos != null) {
                s.avgLatitude = pos[0];
                s.avgLongitude = pos[1];
            } else {
                // Muy pocas muestras: usa la de mejor señal como posición.
                WifiMeasurement best = bestSample(acc.samplesList);
                if (best != null) {
                    s.avgLatitude = best.latitude;
                    s.avgLongitude = best.longitude;
                }
            }
            s.samples = Math.toIntExact(acc.count);
            s.open = acc.openCount > 0 && acc.openCount >= acc.securedCount;
            s.band = acc.band5 >= acc.band24 ? (acc.band5 > 0 ? 2 : 0) : 1;
            out.add(s);
        }
        return out;
    }

    /** Una red es abierta si sus capabilities no indican cifrado. */
    private static boolean isOpenNetwork(String caps) {
        if (caps == null || caps.isEmpty()) return true;
        return !caps.contains("WPA") && !caps.contains("WEP")
                && !caps.contains("RSN") && !caps.contains("SAE")
                && !caps.contains("PSK");
    }

    private static WifiMeasurement bestSample(List<WifiMeasurement> samples) {
        WifiMeasurement best = null;
        for (WifiMeasurement m : samples) {
            if (best == null || m.rssi > best.rssi) {
                best = m;
            }
        }
        return best;
    }

    // Peso de 0 (signal muy débil) a 50 (signal ~ -40 dBm): domina lo cercano.
    private static double rssiWeight(int rssi) {
        return Math.max(0, rssi + 90);
    }

    // Clave de agrupación: el nombre de la red si se conoce, si no su BSSID.
    private static String groupKey(String ssid, String bssid) {
        if (ssid != null && !ssid.isEmpty()) {
            return ssid;
        }
        return bssid == null ? "unknown" : bssid;
    }

    public static List<WifiApSummary> aggregateByCentroid(List<WifiMeasurement> measurements) {
        Map<String, Acc> accMap = new LinkedHashMap<>();
        if (measurements == null) return new ArrayList<>();

        for (WifiMeasurement m : measurements) {
            Acc acc = accMap.get(m.bssid);
            if (acc == null) {
                acc = new Acc();
                acc.bssid = m.bssid;
                acc.rssiSum = m.rssi;
                acc.count = 1;
                acc.latSum = m.latitude;
                acc.lonSum = m.longitude;
                acc.ssid = m.ssid;
                accMap.put(m.bssid, acc);
            } else {
                acc.rssiSum += m.rssi;
                acc.count++;
                acc.latSum += m.latitude;
                acc.lonSum += m.longitude;
                if (m.ssid != null && !m.ssid.isEmpty()) {
                    acc.ssid = m.ssid;
                }
            }
        }

        List<WifiApSummary> out = new ArrayList<>(accMap.size());
        for (Acc acc : accMap.values()) {
            WifiApSummary s = new WifiApSummary();
            s.bssid = acc.bssid;
            s.ssid = acc.ssid;
            s.avgRssi = (double) acc.rssiSum / acc.count;
            s.avgLatitude = acc.latSum / acc.count;
            s.avgLongitude = acc.lonSum / acc.count;
            s.samples = Math.toIntExact(acc.count);
            out.add(s);
        }
        return out;
    }

    private static final class Acc {
        WifiMeasurement best;
        String bssid;
        int rssiSum;
        double rssiW;
        double latW;
        double lonW;
        long count;
        double latSum;
        double lonSum;
        String ssid;
        int openCount;
        int securedCount;
        int band24;
        int band5;
        List<WifiMeasurement> samplesList;
    }
}
