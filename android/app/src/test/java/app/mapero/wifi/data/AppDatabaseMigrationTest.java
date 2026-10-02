package app.mapero.wifi.data;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.database.Cursor;

import androidx.room.Room;
import androidx.room.migration.Migration;
import androidx.room.testing.MigrationTestHelper;
import androidx.sqlite.db.SupportSQLiteDatabase;
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.IOException;
import java.util.List;

/**
 * Migraciones de la base local.
 *
 * La migración 2 -> 4 reconstruye la tabla completa. Si algo sale mal, el
 * usuario pierde todo lo que tenía mapeado, y hasta ahora eso solo se
 * descubría instalando la app en un dispositivo. Room valida el esquema
 * resultante contra el 4.json exportado, así que un cambio de columna, índice o
 * tipo que no coincida hace fallar el test.
 *
 * Los 1.json y 2.json no se escribieron a mano: los generó el propio Room desde
 * el código de las versiones 1 y 2.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AppDatabaseMigrationTest {

    private static final String TEST_DB = "migration-test";

    @Rule
    public MigrationTestHelper helper = new MigrationTestHelper(
            InstrumentationRegistry.getInstrumentation(),
            AppDatabase.class,
            java.util.Collections.emptyList(),
            new FrameworkSQLiteOpenHelperFactory());

    private SupportSQLiteDatabase crear(int version) throws IOException {
        return helper.createDatabase(TEST_DB, version);
    }

    private static void insertar(SupportSQLiteDatabase db, String bssid, String ssid,
                                 double lat, double lon, int rssi, int freq,
                                 String caps, long ts) {
        db.execSQL("INSERT INTO measurements (bssid, ssid, latitude, longitude, rssi, "
                        + "frequency, capabilities, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                new Object[]{bssid, ssid, lat, lon, rssi, freq, caps, ts});
    }

    private static boolean existe(SupportSQLiteDatabase db, String tipo, String nombre) {
        Cursor c = db.query("SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
                new Object[]{tipo, nombre});
        return c.moveToFirst();
    }

    @Test
    public void migra2a4() throws IOException {
        SupportSQLiteDatabase db = crear(2);
        insertar(db, "aa:bb:cc:00:00:01", "RedVieja", -34.6, -58.4, -55, 2412,
                "[WPA2-PSK-CCMP]", 1700000000000L);
        // La fila con capabilities NULL es justamente el caso que la migración
        // tiene que arreglar: en v4 la columna es NOT NULL.
        insertar(db, "aa:bb:cc:00:00:02", "", -34.7, -58.5, -80, 5240, null, 1700000001000L);

        helper.runMigrationsAndValidate(TEST_DB, 4, true, AppDatabase.MIGRATION_2_4);

        Cursor c = db.query("SELECT bssid, ssid, latitude, longitude, rssi, frequency, "
                + "capabilities, timestamp FROM measurements ORDER BY id");
        assertEquals("sobreviven las dos filas", 2, c.getCount());

        assertTrue(c.moveToFirst());
        assertEquals("aa:bb:cc:00:00:01", c.getString(0));
        assertEquals("RedVieja", c.getString(1));
        assertEquals(-34.6, c.getDouble(2), 1e-9);
        assertEquals(-58.4, c.getDouble(3), 1e-9);
        assertEquals(-55, c.getInt(4));
        assertEquals(2412, c.getInt(5));
        assertEquals("[WPA2-PSK-CCMP]", c.getString(6));
        assertEquals(1700000000000L, c.getLong(7));

        assertTrue(c.moveToNext());
        assertEquals("aa:bb:cc:00:00:02", c.getString(0));
        assertEquals("un NULL pasa a cadena vacía", "", c.getString(6));
        assertEquals(1700000001000L, c.getLong(7));
        db.close();
    }

    @Test
    public void migra1a4PorLaCadenaDeMigraciones() throws IOException {
        SupportSQLiteDatabase db = crear(1);
        db.execSQL("INSERT INTO measurements (bssid, ssid, latitude, longitude, rssi, "
                        + "frequency, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                new Object[]{"aa:bb:cc:00:00:09", "MuyVieja", -34.8, -58.6, -70, 2412, 1600000000000L});

        // Un dispositivo en v1 pasa por 1->2 y después 2->4.
        helper.runMigrationsAndValidate(TEST_DB, 4, true,
                AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_4);

        Cursor c = db.query("SELECT bssid, ssid, capabilities, timestamp FROM measurements");
        assertEquals(1, c.getCount());
        assertTrue(c.moveToFirst());
        assertEquals("aa:bb:cc:00:00:09", c.getString(0));
        assertEquals("MuyVieja", c.getString(1));
        assertEquals("la columna se crea vacía", "", c.getString(2));
        assertEquals(1600000000000L, c.getLong(3));
        db.close();
    }

    @Test
    public void migra2a4SobreBaseVacia() throws IOException {
        SupportSQLiteDatabase db = crear(2);
        helper.runMigrationsAndValidate(TEST_DB, 4, true, AppDatabase.MIGRATION_2_4);
        Cursor c = db.query("SELECT COUNT(*) FROM measurements");
        assertTrue(c.moveToFirst());
        assertEquals(0, c.getInt(0));
        db.close();
    }

    @Test
    public void elIndicePorBssidSobreviveLaReconstruccion() throws IOException {
        SupportSQLiteDatabase db = crear(2);
        assertTrue("el índice debería existir en v2",
                existe(db, "index", "index_measurements_bssid"));

        helper.runMigrationsAndValidate(TEST_DB, 4, true, AppDatabase.MIGRATION_2_4);

        // Sin este índice, cada agrupación por red es un escaneo completo.
        assertTrue("el índice por bssid se perdió al reconstruir la tabla",
                existe(db, "index", "index_measurements_bssid"));
        db.close();
    }

    @Test
    public void laTablaViejaNoQueda() throws IOException {
        SupportSQLiteDatabase db = crear(2);
        helper.runMigrationsAndValidate(TEST_DB, 4, true, AppDatabase.MIGRATION_2_4);
        // Si la reconstrucción fallara a mitad, quedarían las dos tablas. Room
        // no valida esto, lo comprueba el test.
        assertFalse("sobró la tabla measurements_old", existe(db, "table", "measurements_old"));
        db.close();
    }

    @Test
    public void laAppAbreLaBaseMigradaSinPedirMigracion() throws IOException {
        SupportSQLiteDatabase db = crear(2);
        insertar(db, "aa:bb:cc:00:00:03", "Post", -34.9, -58.7, -60, 2412, "[ESS]", 1700000002000L);
        helper.runMigrationsAndValidate(TEST_DB, 4, true, AppDatabase.MIGRATION_2_4);
        db.close();

        // La comprobación de humo más importante: con la base ya en v4, la app
        // tiene que abrirla sin pedir migración.
        Context context = ApplicationProvider.getApplicationContext();
        AppDatabase app = Room.databaseBuilder(context, AppDatabase.class, TEST_DB)
                .allowMainThreadQueries()
                .build();
        try {
            List<WifiMeasurement> todas = app.wifiDao().getAll();
            assertEquals(1, todas.size());
            assertEquals("Post", todas.get(0).ssid);
            assertEquals("[ESS]", todas.get(0).capabilities);
            assertNotNull(app.wifiDao().observeAll());
        } finally {
            app.close();
        }
    }

    @Test
    public void unaMigracionQueNoMigreFallaLaValidacion() throws IOException {
        // Guarda contra tests que se relajen: si la validación de esquema no
        // detectara una migración que no hace nada, los otros tests no probarían
        // nada.
        SupportSQLiteDatabase db = crear(2);
        Migration noOp = new Migration(2, 4) {
            @Override
            public void migrate(SupportSQLiteDatabase d) {
                // Deja la tabla como estaba.
            }
        };
        try {
            helper.runMigrationsAndValidate(TEST_DB, 4, true, noOp);
            fail("una migración que no hace nada debería fallar la validación");
        } catch (IllegalStateException esperado) {
            assertNotNull(esperado.getMessage());
        }
        db.close();
    }
}
