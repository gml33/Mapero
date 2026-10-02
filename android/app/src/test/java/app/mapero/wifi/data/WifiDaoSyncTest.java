package app.mapero.wifi.data;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.room.Room;
import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

/**
 * Consultas de subida incremental.
 *
 * El cursor de subida es el id de la última fila que el servidor confirmó. Se
 * prueba contra Room de verdad, no contra una imitación, para que lo que se
 * verifica sea el SQL que corre en el dispositivo.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class WifiDaoSyncTest {

    private AppDatabase db;
    private WifiDao dao;

    @Before
    public void setUp() {
        Context context = ApplicationProvider.getApplicationContext();
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase.class)
                .allowMainThreadQueries()
                .build();
        dao = db.wifiDao();
    }

    @After
    public void tearDown() {
        db.close();
    }

    private static WifiMeasurement fila(String bssid, long ts) {
        WifiMeasurement m = new WifiMeasurement();
        m.bssid = bssid;
        m.ssid = "Red";
        m.latitude = -34.6;
        m.longitude = -58.4;
        m.rssi = -60;
        m.frequency = 2412;
        m.capabilities = "[ESS]";
        m.timestamp = ts;
        return m;
    }

    private List<Long> ids(List<WifiMeasurement> lista) {
        List<Long> out = new ArrayList<>();
        for (WifiMeasurement m : lista) out.add(m.id);
        return out;
    }

    @Test
    public void getSinceId_devuelveLoQueEstaDespuesDelCursor() {
        dao.insertAll(java.util.Arrays.asList(
                fila("a", 1000), fila("b", 1000), fila("c", 1000)));
        List<WifiMeasurement> todos = dao.getAll();
        long segundo = todos.get(1).id;

        List<WifiMeasurement> desde = dao.getSinceId(segundo, 100);
        assertEquals("solo lo que va después del cursor", 1, desde.size());
        assertEquals(todos.get(2).id, desde.get(0).id);
    }

    @Test
    public void getSinceId_conCursorCeroDevuelveTodo() {
        dao.insertAll(java.util.Arrays.asList(fila("a", 1000), fila("b", 1000)));
        assertEquals(2, dao.getSinceId(0, 100).size());
    }

    @Test
    public void getSinceId_ordenaPorId() {
        // Se insertan en un orden de timestamp que no coincide con el id: el cursor es
        // el id, así que tiene que devolver por id y no por fecha.
        dao.insert(fila("a", 9000));
        dao.insert(fila("b", 1000));
        List<WifiMeasurement> todos = dao.getAll();
        List<Long> esperados = new ArrayList<>();
        esperados.add(todos.get(0).id);
        esperados.add(todos.get(1).id);
        assertEquals(esperados, ids(dao.getSinceId(0, 100)));
    }

    @Test
    public void getSinceId_respetaElLimiteYHaceFaltaPaginar() {
        List<WifiMeasurement> lote = new ArrayList<>();
        for (int i = 0; i < 7; i++) lote.add(fila("bs" + i, 1000 + i));
        dao.insertAll(lote);

        List<WifiMeasurement> primera = dao.getSinceId(0, 3);
        assertEquals("respeta el límite", 3, primera.size());

        long ultimoDeLaPrimera = primera.get(2).id;
        List<WifiMeasurement> segunda = dao.getSinceId(ultimoDeLaPrimera, 3);
        assertEquals(3, segunda.size());
        assertTrue("la segunda página sigue a la primera",
                segunda.get(0).id > ultimoDeLaPrimera);

        List<WifiMeasurement> tercera = dao.getSinceId(segunda.get(2).id, 3);
        assertEquals(1, tercera.size());

        // Recorrer las páginas tiene que cubrir todo, sin repetidos.
        List<Long> vistos = new ArrayList<>();
        long cursor = 0;
        while (true) {
            List<WifiMeasurement> pagina = dao.getSinceId(cursor, 3);
            if (pagina.isEmpty()) break;
            vistos.addAll(ids(pagina));
            cursor = pagina.get(pagina.size() - 1).id;
        }
        assertEquals(7, vistos.size());
        assertEquals("sin repetidos", 7, new java.util.HashSet<>(vistos).size());
    }

    @Test
    public void getSinceId_noRepiteLoYaSubido() {
        List<WifiMeasurement> lote = new ArrayList<>();
        for (int i = 0; i < 5; i++) lote.add(fila("bs" + i, 1000 + i));
        dao.insertAll(lote);
        long cursor = dao.getSinceId(0, 100).get(2).id;

        // Se "suben" las tres primeras y después se vuelve a pedir desde el cursor.
        assertEquals("solo las dos que faltaban", 2, dao.getSinceId(cursor, 100).size());
        assertEquals("y otra vez lo mismo, sigue igual", 2, dao.getSinceId(cursor, 100).size());
    }

    @Test
    public void getSinceId_conBaseVaciaDevuelveVacio() {
        assertTrue(dao.getSinceId(0, 100).isEmpty());
        assertTrue(dao.getSinceId(999, 100).isEmpty());
    }

    @Test
    public void firstIdAfterTimestamp_encuentraElEquivalenteDeUnCursorViejo() {
        // Se insertan en orden de id, con timestamps que no lo siguen.
        dao.insert(fila("a", 1000));
        dao.insert(fila("b", 2000));
        dao.insert(fila("c", 3000));

        // Con el cursor viejo en 2000, lo que falta es lo de 3000 para arriba.
        Long primero = dao.firstIdAfterTimestamp(2000);
        assertNotNull(primero);

        List<WifiMeasurement> desde = dao.getSinceId(primero - 1, 100);
        assertEquals(1, desde.size());
        assertEquals(3000L, desde.get(0).timestamp);
    }

    @Test
    public void firstIdAfterTimestamp_siNoHayNadaNuevoDevuelveNull() {
        dao.insert(fila("a", 1000));
        // Con un cursor posterior a todo lo guardado no queda nada pendiente.
        assertNull(dao.firstIdAfterTimestamp(9999999));
    }

    @Test
    public void firstIdAfterTimestamp_conBaseVaciaDevuelveNull() {
        assertNull(dao.firstIdAfterTimestamp(1000));
    }

    @Test
    public void elCursorNoSalteaMedicionesQueCompartenTimestamp() {
        // El motivo por el que el cursor era un id y no un timestamp: dos
        // mediciones del mismo barrido comparten milisegundo, y con un cursor de
        // tiempo la segunda se pisaba con la primera.
        List<WifiMeasurement> lote = new ArrayList<>();
        for (int i = 0; i < 4; i++) lote.add(fila("bs" + i, 5000));
        dao.insertAll(lote);

        List<WifiMeasurement> todos = dao.getSinceId(0, 100);
        assertEquals(4, todos.size());

        // Cursor en la primera: quedan las otras tres, aunque tengan el mismo ts.
        long cursor = todos.get(0).id;
        assertEquals(3, dao.getSinceId(cursor, 100).size());
    }
}
