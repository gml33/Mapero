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
                assertEquals("sin cifrado es abierta", Boolean.TRUE, s.open);
            } else {
                assertEquals("con WPA2 es protegida", Boolean.FALSE, s.open);
            }
        }
    }

    // ---- Estado de seguridad tri-estado ----
    // Las mediciones anteriores a la columna capabilities no dicen nada. Antes
    // se contaban como abiertas, así que toda esa data aparecía como red abierta.

    private static WifiApSummary oneSummary(WifiMeasurement... samples) {
        List<WifiApSummary> out =
                SignalAggregator.aggregateByTrilateration(Arrays.asList(samples));
        assertEquals(1, out.size());
        return out.get(0);
    }

    private static WifiMeasurement withCaps(String bssid, String ssid, String caps) {
        WifiMeasurement x = m(bssid, ssid, -34.6, -58.4, -60);
        x.capabilities = caps;
        return x;
    }

    @Test
    public void seguridad_sinCapabilitiesEsNullYNoAbierta() {
        WifiApSummary s = oneSummary(withCaps("aa", "Legacy", ""));
        assertNull("sin capabilities no se puede clasificar", s.open);
    }

    @Test
    public void seguridad_capabilitiesNullEsNull() {
        WifiMeasurement x = m("aa", "Legacy", -34.6, -58.4, -60);
        x.capabilities = null;
        assertNull(oneSummary(x).open);
    }

    @Test
    public void seguridad_mayoriaProtegidaGana() {
        // 3 mediciones con cifrado y 1 sin capabilities: la desconocida no cuenta
        // como abierta, así que la red es protegida.
        WifiApSummary s = oneSummary(
                withCaps("aa", "Red", "[WPA2-PSK-CCMP]"),
                withCaps("bb", "Red", "[WPA2-PSK-CCMP]"),
                withCaps("cc", "Red", "[WPA2-PSK-CCMP]"),
                withCaps("dd", "Red", ""));
        assertEquals(Boolean.FALSE, s.open);
    }

    @Test
    public void seguridad_mayoriaAbiertaGana() {
        // 3 abiertas contra 2 protegidas: mayoría abierta, la desconocida no pesa.
        WifiApSummary s = oneSummary(
                withCaps("aa", "Red", "[ESS]"),
                withCaps("bb", "Red", "[ESS]"),
                withCaps("cc", "Red", "[ESS]"),
                withCaps("dd", "Red", "[WPA2-PSK-CCMP]"),
                withCaps("ee", "Red", "[WPA2-PSK-CCMP]"),
                withCaps("ff", "Red", ""));
        assertEquals(Boolean.TRUE, s.open);
    }

    @Test
    public void seguridad_empateVaAProtegida() {
        // El servidor resuelve el empate con la moda, que ordena 0=protegida
        // antes que 1=abierta, así que el empate cae en protegida. La app tiene
        // que coincidir o la misma red se ve distinta en el mapa y en la web.
        WifiApSummary s = oneSummary(
                withCaps("aa", "Red", "[ESS]"),
                withCaps("bb", "Red", "[WPA2-PSK-CCMP]"));
        assertEquals("el empate va a protegida", Boolean.FALSE, s.open);
    }

    @Test
    public void seguridad_todasDesconocidasEsNull() {
        WifiApSummary s = oneSummary(
                withCaps("aa", "Red", ""),
                withCaps("bb", "Red", ""),
                withCaps("cc", "Red", ""));
        assertNull(s.open);
    }

    @Test
    public void seguridad_sinMuestrasDesconocidasEsNull() {
        WifiApSummary s = oneSummary(
                withCaps("aa", "Red", "[ESS]"),
                withCaps("bb", "Red", "[RSN-SAE-CCMP]"));
        assertEquals(Boolean.FALSE, s.open);
    }

    @Test
    public void seguridad_ESSYSAEClaves() {
        // Los marcadores de cifrado tienen que seguir detectándose.
        assertEquals(Boolean.TRUE, oneSummary(withCaps("a", "R", "[ESS]")).open);
        assertEquals(Boolean.FALSE, oneSummary(withCaps("a", "R", "[WPA2-PSK-CCMP][ESS]")).open);
        assertEquals(Boolean.FALSE, oneSummary(withCaps("a", "R", "[RSN-SAE-CCMP][ESS]")).open);
        assertEquals(Boolean.FALSE, oneSummary(withCaps("a", "R", "[WEP][ESS]")).open);
    }
}
