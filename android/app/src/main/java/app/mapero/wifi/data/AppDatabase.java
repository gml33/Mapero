package app.mapero.wifi.data;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;
import androidx.room.migration.Migration;
import androidx.sqlite.db.SupportSQLiteDatabase;

@Database(entities = {WifiMeasurement.class}, version = 4, exportSchema = false)
public abstract class AppDatabase extends RoomDatabase {

    private static volatile AppDatabase INSTANCE;

    public abstract WifiDao wifiDao();

    // v1 -> v2: agregar la columna capabilities con valor por defecto.
    static final Migration MIGRATION_1_2 = new Migration(1, 2) {
        @Override
        public void migrate(SupportSQLiteDatabase db) {
            db.execSQL("ALTER TABLE measurements ADD COLUMN capabilities TEXT NOT NULL DEFAULT ''");
        }
    };

    private static void rebuildMeasurementsTable(SupportSQLiteDatabase db) {
        db.execSQL("ALTER TABLE measurements RENAME TO measurements_old");
        db.execSQL("CREATE TABLE measurements ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "
                + "bssid TEXT NOT NULL, "
                + "ssid TEXT, "
                + "latitude REAL NOT NULL, "
                + "longitude REAL NOT NULL, "
                + "rssi INTEGER NOT NULL, "
                + "frequency INTEGER NOT NULL, "
                + "capabilities TEXT NOT NULL DEFAULT '', "
                + "timestamp INTEGER NOT NULL"
                + ")");
        db.execSQL("INSERT INTO measurements "
                + "(id, bssid, ssid, latitude, longitude, rssi, frequency, capabilities, timestamp) "
                + "SELECT id, bssid, ssid, latitude, longitude, rssi, frequency, "
                + "COALESCE(capabilities, ''), timestamp FROM measurements_old");
        db.execSQL("DROP TABLE measurements_old");
        db.execSQL("CREATE INDEX index_measurements_bssid ON measurements(bssid)");
    }

    // v2 -> v4: normalizar el esquema para que capabilities sea NOT NULL DEFAULT ''
    // y restaurar el índice por bssid.
    static final Migration MIGRATION_2_4 = new Migration(2, 4) {
        @Override
        public void migrate(SupportSQLiteDatabase db) {
            rebuildMeasurementsTable(db);
        }
    };

    // v3 -> v4: repara instalaciones que quedaron sin índice al reconstruir la tabla.
    static final Migration MIGRATION_3_4 = new Migration(3, 4) {
        @Override
        public void migrate(SupportSQLiteDatabase db) {
            rebuildMeasurementsTable(db);
        }
    };

    public static AppDatabase getInstance(Context context) {
        if (INSTANCE == null) {
            synchronized (AppDatabase.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(
                            context.getApplicationContext(),
                            AppDatabase.class,
                            "wifi_mapper.db")
                            .addMigrations(MIGRATION_1_2, MIGRATION_2_4, MIGRATION_3_4)
                            .build();
                }
            }
        }
        return INSTANCE;
    }
}
