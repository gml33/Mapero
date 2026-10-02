package app.mapero.wifi.data;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Agregación de mediciones por red. Pruebas de JVM, sin emulador.
 */
public class SignalAggregatorTest {

    private static WifiMeasurement m(String bssid, String ssid, double lat, double lon, int rssi) {
        WifiMeasurement x = new WifiMeasurement();
        x.bssid = bssid;
        x.ssid = ssid;
        x.latitude = lat;
        x.longitude = lon;
        x.rssi = rssi;
        x.capabilities = "[WPA2-PSK-CCMP][RSN-SAE-CCMP]";
        return x;
    }

    private static WifiApSummary byBssid(List<WifiApSummary> list, String bssid) {
        for (WifiApSummary s : list) {
            if (bssid.equals(s.bssid)) return s;
        }
        return null;
    }

    @Test
    public void aggregateByBestSignal_agrupaPorBssid() {
        List<WifiApSummary> out = SignalAggregator.aggregateByBestSignal(Arrays.asList(
                m("aa", "RedA", -34.60, -58.40, -70),
                m("bb", "RedB", -34.61, -58.41, -75),
                m("aa", "RedA", -34.62, -58.42, -60)));
        assertEquals(2, out.size());
        assertNotNull(byBssid(out, "aa"));
        assertNotNull(byBssid(out, "bb"));
    }

    @Test
    public void aggregateByBestSignal_promediaLaSenal() {
        List<WifiApSummary> out = SignalAggregator.aggregateByBestSignal(Arrays.asList(
                m("aa", "RedA", -34.60, -58.40, -70),
                m("aa", "RedA", -34.61, -58.41, -50),
                m("aa", "RedA", -34.62, -58.42, -60)));
        WifiApSummary a = byBssid(out, "aa");
        assertNotNull(a);
        assertEquals("promedio de -70, -50 y -60", -60.0, a.avgRssi, 0.001);
        assertEquals(3, a.samples);
    }

    @Test
    public void aggregateByBestSignal_conservaLaPosicionDeLaMuestraMasFuerte() {
        // La muestra de -50 dBm es la más cercana al AP, así que su coordenada
        // es la mejor estimación. Un promedio la correría.
        List<WifiApSummary> out = SignalAggregator.aggregateByBestSignal(Arrays.asList(
                m("aa", "RedA", -34.6000, -58.4000, -90),
                m("aa", "RedA", -34.6100, -58.4100, -50),
                m("aa", "RedA", -34.6050, -58.4050, -80)));
        WifiApSummary a = byBssid(out, "aa");
        assertNotNull(a);
        assertEquals(-34.6100, a.avgLatitude, 1e-9);
        assertEquals(-58.4100, a.avgLongitude, 1e-9);
    }

    @Test
    public void aggregateByBestSignal_elSsidSeCompletaConLaMuestraQueLoTiene() {
        List<WifiApSummary> out = SignalAggregator.aggregateByBestSignal(Arrays.asList(
                m("aa", "", -34.60, -58.40, -70),
                m("aa", "RedA", -34.60, -58.40, -70)));
        assertEquals("RedA", byBssid(out, "aa").ssid);
    }

    @Test
    public void aggregatePorCentroid_agrupaPorBssid() {
        List<WifiApSummary> out = SignalAggregator.aggregateByCentroid(Arrays.asList(
                m("aa", "RedA", -34.60, -58.40, -70),
                m("bb", "RedB", -34.61, -58.41, -70),
                m("aa", "RedA", -34.62, -58.42, -70)));
        assertEquals(2, out.size());
        assertEquals(2, byBssid(out, "aa").samples);
        assertEquals(1, byBssid(out, "bb").samples);
    }

    @Test
    public void aggregatePorCentroid_promediaLasCoordenadas() {
        List<WifiApSummary> out = SignalAggregator.aggregateByCentroid(Arrays.asList(
                m("aa", "RedA", -34.60, -58.40, -70),
                m("aa", "RedA", -34.62, -58.44, -70)));
        WifiApSummary a = byBssid(out, "aa");
        assertNotNull(a);
        assertEquals(-34.61, a.avgLatitude, 1e-9);
        assertEquals(-58.42, a.avgLongitude, 1e-9);
    }

    @Test
    public void aggregatePorTrilateracion_agrupaPorNombreDeRed() {
        // Dos antenas con el mismo SSID son la misma red para el usuario.
        List<WifiApSummary> out = SignalAggregator.aggregateByTrilateration(Arrays.asList(
                m("aa", "RedA", -34.6000, -58.4000, -55),
                m("bb", "RedA", -34.6050, -58.4000, -60),
                m("cc", "RedB", -34.7000, -58.7000, -70)));
        assertEquals("dos redes por nombre, no tres por BSSID", 2, out.size());
    }

    @Test
    public void aggregatePorTrilateration_sinNombreUsaElBssid() {
        List<WifiApSummary> out = SignalAggregator.aggregateByTrilateration(Arrays.asList(
                m("aa", "", -34.6000, -58.4000, -55),
                m("bb", "", -34.7000, -58.7000, -70)));
        assertEquals(2, out.size());
    }

    @Test
    public void aggregatePorTrilateracion_sinMuestrasDevuelveVacio() {
        assertEquals(0, SignalAggregator.aggregateByBestSignal(null).size());
        assertEquals(0, SignalAggregator.aggregateByCentroid(null).size());
        assertEquals(0, SignalAggregator.aggregateByTrilateration(null).size());
        assertEquals(0, SignalAggregator.aggregateByBestSignal(new ArrayList<>()).size());
    }

    @Test
    public void aggregatePorTrilateracion_noDevuelveNaN() {
        List<WifiApSummary> out = SignalAggregator.aggregateByTrilateration(Arrays.asList(
                m("aa", "RedA", -34.6000, -58.4000, -100),
                m("bb", "RedA", -34.6001, -58.4001, -100),
                m("cc", "RedA", -34.6002, -58.4002, -100)));
        assertEquals(1, out.size());
        WifiApSummary a = out.get(0);
        assertTrue("lat sin NaN", !Double.isNaN(a.avgLatitude) && !Double.isInfinite(a.avgLatitude));
        assertTrue("lon sin NaN", !Double.isNaN(a.avgLongitude) && !Double.isInfinite(a.avgLongitude));
    }

    @Test
    public void aggregatePorTrilateracion_clasificaAbiertaYProtegida() {
        WifiMeasurement abierta = m("aa", "Abierta", -34.6, -58.4, -60);
        abierta.capabilities = "[ESS]";
        WifiMeasurement protegida = m("bb", "Protegida", -34.7, -58.7, -60);
        protegida.capabilities = "[WPA2-PSK-CCMP][RSN-SAE-CCMP]";

        List<WifiApSummary> out =
                SignalAggregator.aggregateByTrilateration(Arrays.asList(abierta, protegida));
        assertEquals(2, out.size());
        for (WifiApSummary s : out) {
            if ("Abierta".equals(s.ssid)) {
                assertTrue("sin cifrado es abierta", s.open);
            } else {
                assertTrue("con WPA2 es protegida", !s.open);
            }
        }
    }
}
