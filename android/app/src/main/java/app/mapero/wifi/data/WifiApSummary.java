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
    /**
     * Estado de seguridad de la red: true abierta, false protegida,
     * null si las mediciones no traen capabilities y no se puede clasificar.
     *
     * El tri-estado importa porque las mediciones anteriores a la columna
     * capabilities no dicen nada: no son redes abiertas, son redes sin dato.
     * El servidor clasifica igual, con el mismo criterio.
     */
    public Boolean open;
    /** 1 = 2,4 GHz · 2 = 5 GHz · 3 = 6 GHz (WiFi 6E) · 0 = desconocida. */
    public int band;
}
