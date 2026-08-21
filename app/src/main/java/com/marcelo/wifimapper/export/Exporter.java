package com.marcelo.wifimapper.export;

import com.marcelo.wifimapper.data.WifiApSummary;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * Genera archivos CSV y KML con los puntos de acceso recopilados.
 */
public final class Exporter {

    private Exporter() {
    }

    public static File toCsv(File dir, List<WifiApSummary> aps) throws IOException {
        File file = new File(dir, "wifimapper.csv");
        StringBuilder sb = new StringBuilder();
        sb.append("bssid,ssid,latitude,longitude,rssi_dbm,frecuencia,samples\n");
        for (WifiApSummary ap : aps) {
            sb.append(csv(ap.bssid)).append(',')
              .append(csv(ap.ssid)).append(',')
              .append(ap.avgLatitude).append(',')
              .append(ap.avgLongitude).append(',')
              .append(String.format(Locale.ROOT, "%.1f", ap.avgRssi)).append(",-,")
              .append(ap.samples).append('\n');
        }
        write(file, sb.toString());
        return file;
    }

    public static File toKml(File dir, List<WifiApSummary> aps) throws IOException {
        File file = new File(dir, "wifimapper.kml");
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
          .append("<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n")
          .append("<Document><name>WifiMapper</name>\n");
        for (WifiApSummary ap : aps) {
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
        write(file, sb.toString());
        return file;
    }

    private static void write(File file, String content) throws IOException {
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
        return value.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;");
    }
}
