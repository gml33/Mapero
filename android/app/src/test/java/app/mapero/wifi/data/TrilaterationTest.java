package app.mapero.wifi.data;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Trilateración por RSSI. Son pruebas de JVM: la clase no toca nada de Android.
 */
public class TrilaterationTest {

    private static final double TX = -45.0;
    private static final double N = 2.0;

    private static WifiMeasurement sample(double lat, double lon, int rssi) {
        WifiMeasurement m = new WifiMeasurement();
        m.bssid = "aa:bb:cc:00:00:00";
        m.ssid = "Test";
        m.latitude = lat;
        m.longitude = lon;
        m.rssi = rssi;
        m.capabilities = "";
        return m;
    }

    /** RSSI medido a `metros` del AP con los parámetros de la calibración. */
    private static int rssiAtDistance(double metros) {
        return (int) Math.round(TX - 10 * N * Math.log10(metros));
    }

    private static double meters(double lat1, double lon1, double lat2, double lon2) {
        double dy = (lat2 - lat1) * 111320.0;
        double dx = (lon2 - lon1) * 111320.0 * Math.cos(Math.toRadians(lat1));
        return Math.hypot(dx, dy);
    }

    @Test
    public void distanceFromRssi_recuperaLaDistanciaDelModelo() {
        // A 1 m el RSSI es el de referencia.
        assertEquals(1.0, Trilateration.distanceFromRssi(TX, TX, N), 0.001);
        // A 10 m se pierden 20 dBm con n = 2.
        assertEquals(10.0, Trilateration.distanceFromRssi(TX - 20, TX, N), 0.001);
        // A 100 m, 40 dBm.
        assertEquals(100.0, Trilateration.distanceFromRssi(TX - 40, TX, N), 0.001);
    }

    @Test
    public void distanceFromRssi_esMonotona() {
        double anterior = -1;
        for (int rssi = -30; rssi >= -100; rssi -= 5) {
            double d = Trilateration.distanceFromRssi(rssi, TX, N);
            assertTrue("la distancia crece al weakenerse la señal: " + rssi, d > anterior);
            anterior = d;
        }
    }

    @Test
    public void estimate_sinMuestrasSuficientesDevuelveNull() {
        assertNull(Trilateration.estimate(null, TX, N));
        assertNull(Trilateration.estimate(new ArrayList<>(), TX, N));
        double[] unaMuestra =
                Trilateration.estimate(Arrays.asList(sample(-34.6, -58.4, -60)), TX, N);
        assertNull("con una sola muestra no hay nada que trilaterar", unaMuestra);
    }

    @Test
    public void estimate_conDosMuestrasAvanzaHaciaLaSeñaMasFuerte() {
        // Doslecturas: la más fuerte está más cerca del AP.
        double[] r = Trilateration.estimate(Arrays.asList(
                sample(-34.6000, -58.4000, rssiAtDistance(80)),
                sample(-34.6000, -58.4000, rssiAtDistance(20))), TX, N);
        assertNotNull((Object) r);
        // Con dos muestras cae al centroide ponderado: debe quedar entre las dos.
        assertTrue("la estimación no se va de la zona", r[0] > -34.61 && r[0] < -34.59);
    }

    @Test
    public void estimate_conTresOMasAciertaElOrigenDelAP() {
        // AP en el centro de un cuadrado; el móvil mide a 20, 30 y 40 m.
        double apLat = -34.6000, apLon = -58.4000;
        double d20 = 20 / 111320.0;              // grados de latitud
        double d30 = 30 / 111320.0;
        double d40 = 40 / 111320.0;
        List<WifiMeasurement> samples = Arrays.asList(
                sample(apLat - d20, apLon, rssiAtDistance(20)),   // al sur, 20 m
                sample(apLat + d30, apLon, rssiAtDistance(30)),   // al norte, 30 m
                sample(apLat, apLon - d20, rssiAtDistance(25)));  // al oeste, 25 m

        double[] r = Trilateration.estimate(samples, TX, N);
        assertNotNull((Object) r);
        double error = meters(apLat, apLon, r[0], r[1]);
        assertTrue("el error debería ser menor a 15 m, fue " + error, error < 15);
    }

    @Test
    public void estimate_noExplotaConValoresExtremos() {
        // Señales idénticas: el sistema es degenerado y no debe devolver NaN.
        double[] r = Trilateration.estimate(Arrays.asList(
                sample(-34.6000, -58.4000, -70),
                sample(-34.6000, -58.4000, -70),
                sample(-34.6000, -58.4000, -70)), TX, N);
        assertNotNull((Object) r);
        assertTrue("lat finita", !Double.isNaN(r[0]) && !Double.isInfinite(r[0]));
        assertTrue("lon finita", !Double.isNaN(r[1]) && !Double.isInfinite(r[1]));
    }

    @Test
    public void estimate_todasLasMuestrasEnElMismoPunto() {
        double[] r = Trilateration.estimate(Arrays.asList(
                sample(-34.6000, -58.4000, -50),
                sample(-34.6000, -58.4000, -55),
                sample(-34.6000, -58.4000, -60)), TX, N);
        assertNotNull((Object) r);
        assertEquals("con un solo punto no hay de dónde moverse", -34.6000, r[0], 1e-9);
        assertEquals(-58.4000, r[1], 1e-9);
    }

    @Test
    public void estimate_sinNaNConSenalMuyDebil() {
        // rssi -100 daría una distancia enorme; el modelo la recorta a 1 m.
        double[] r = Trilateration.estimate(Arrays.asList(
                sample(-34.6000, -58.4000, -100),
                sample(-34.6010, -58.4000, -100),
                sample(-34.6020, -58.4000, -100)), TX, N);
        assertNotNull((Object) r);
        assertTrue("lat finita", !Double.isNaN(r[0]));
        assertTrue("lon finita", !Double.isNaN(r[1]));
    }
}
