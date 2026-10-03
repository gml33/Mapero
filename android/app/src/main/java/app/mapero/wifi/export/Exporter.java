package app.mapero.wifi.export;

import app.mapero.wifi.data.WifiApSummary;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Genera archivos CSV y KML con los puntos de acceso recopilados.
 */
public final class Exporter {

    private Exporter() {
    }

    /**
     * Filtros que coinciden con los del mapa (MainActivity.matchesFilters y
     * networkPredicate del servidor).
     */
    public static final class Filters {
        public int filterType = 0;           // 0=todas, 1=abiertas, 2=protegidas, 3=sin datos
        public int filterBand = 0;           // 0=todas, 1=2,4, 2=5, 3=6
        public int filterMinSignal = -200;   // dBm
        public String filterUser = "";       // usuario específico
        public String filterQuery = "";      // búsqueda por nombre
        public java.util.Set<String> hiddenNames = java.util.Set.of();  // SSID/BSSID a ocultar

        public boolean matches(WifiApSummary ap) {
            // Seguridad (tri-estado)
            if (filterType == 1 && ap.open != true) return false;
            if (filterType == 2 && ap.open != false) return false;
            if (filterType == 3 && ap.open != null) return false;

            // Banda
            if (filterBand == 1 && ap.band != 1) return false;
            if (filterBand == 2 && ap.band != 2) return false;
            if (filterBand == 3 && ap.band != 3) return false;

            // Señal mínima
            if (ap.avgRssi < filterMinSignal) return false;

            // Usuario
            if (!filterUser.isEmpty() && !ap.ssid.equals(filterUser)) return false;

            // Búsqueda por nombre
            if (!filterQuery.isEmpty() &&
                    !String.valueOf(ap.ssid).toLowerCase().contains(filterQuery.toLowerCase())) {
                return false;
            }

            // Ocultos
            String key = ap.ssid != null && !ap.ssid.isEmpty() ? ap.ssid : ap.bssid;
            if (hiddenNames.contains(key.toLowerCase())) return false;

            return true;
        }
    }

    public static File toCsv(File dir, List<WifiApSummary> aps, Filters filters) throws IOException {
        File file = new File(dir, "wifimapper.csv");
        StringBuilder sb = new StringBuilder();
        sb.append("bssid,ssid,latitude,longitude,rssi_dbm,frequency,samples\n");
        for (WifiApSummary ap : aps) {
            if (!filters.matches(ap)) continue;
            sb.append(csv(ap.bssid)).append(',')
              .append(csv(ap.ssid)).append(',')
              .append(ap.avgLatitude).append(',')
              .append(ap.avgLongitude).append(',')
              .append(String.format(Locale.ROOT, "%.1f", ap.avgRssi)).append(",-\n")
              .append(ap.samples).append("\n");
        }
        write(dir, "wifimapper.csv", sb.toString());
        return file;
    }

    public static File toKml(File dir, List<WifiApSummary> aps, Filters filters) throws IOException {
        File file = new File(dir, "wifimapper.kml");
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
          .append("<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n")
          .append("<Document><name>WifiMapper</name>\n");
        for (WifiApSummary ap : aps) {
            if (!filters.matches(ap)) continue;
            String name = ap.ssid != null && !ap.ssid.isEmpty() ? ap.ssid : ap.bssid;
            sb.append("<Placemark><name>").append(esc(name)).append("</name>\n")
              .append("<description>RSSI ")
              .append(String.format(Locale.ROOT, "%.1f", ap.avgRssi))
              .append(" dBm - ").append(ap.samples).append(" muestras</description>\n")
              .append("<Point><coordinates>")
              .append(String.format(Locale.ROOT, "%.6f,%.6f,0", ap.avgLongitude, ap.avgLatitude))
              .append("</coordinates></Point>\n")
              .append("</Placemark>\n");
        }
        sb.append("</Document></kml>\n");
        write(dir, "wifimapper.kml", sb.toString());
        return file;
    }

    // Sobrecargas de compatibilidad (sin filtros = exportar todo)
    public static File toCsv(File dir, List<WifiApSummary> aps) throws IOException {
        return toCsv(dir, aps, new Filters());
    }

    public static File toKml(File dir, List<WifiApSummary> aps) throws IOException {
        return toKml(dir, aps, new Filters());
    }

    private static void write(File dir, String filename, String content) throws IOException {
        File file = new File(dir, filename);
        try (OutputStreamWriter w = new OutputStreamWriter(
                new FileOutputStream(file), StandardCharsets.UTF_8)) {
            w.write(content);
        }
    }

    private static String csv(String value) {
        if (value == null) return "";
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static String esc(String value) {
        if (value == null) return "";
        return value.replace("&", "&").replace("<", "<")
                .replace(">", ">");
    }
}
