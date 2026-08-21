package app.mapero.wifi.data;

/**
 * Resultado agregado de un punto de acceso: promedia la señal y las coordenadas,
 * agrupado por BSSID, para representar un único punto en el mapa.
 */
public class WifiApSummary {

    public String bssid;
    public String ssid;
    public double avgRssi;
    public double avgLatitude;
    public double avgLongitude;
    public int samples;
    /** true si la red es abierta (sin cifrado). */
    public boolean open;
    /** 1 = 2,4 GHz, 2 = 5 GHz, 0 = desconocida. */
    public int band;
}
