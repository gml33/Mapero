package app.mapero.wifi.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.lifecycle.LiveData;

import java.util.List;

@Dao
public interface WifiDao {

    @Insert
    void insert(WifiMeasurement measurement);

    @Insert
    void insertAll(List<WifiMeasurement> measurements);

    @Query("SELECT * FROM measurements")
    LiveData<List<WifiMeasurement>> observeAll();

    @Query("SELECT * FROM measurements ORDER BY bssid, timestamp")
    List<WifiMeasurement> getAll();

    /**
     * Página de lo que falta subir, para no cargar la base entera en memoria.
     *
     * El cursor es el id y no el timestamp a propósito: `id` es la clave
     * primaria y por lo tanto el rowid de SQLite, así que el filtro usa el
     * índice que ya existe y no hace falta agregar ninguno. Con el timestamp
     * había dos problemas: no había índice, y las mediciones que compartían
     * milisegundo se pisaban unas a otras.
     */
    @Query("SELECT * FROM measurements WHERE id > :id ORDER BY id LIMIT :limit")
    List<WifiMeasurement> getSinceId(long id, int limit);

    /**
     * Id equivalente a un cursor de timestamp: el id de la primera medición más
     * nueva que el cursor. Sirve para migrar el cursor viejo, que guardaba un
     * timestamp, sin volver a subir toda la historia.
     */
    @Query("SELECT MIN(id) FROM measurements WHERE timestamp > :timestamp")
    Long firstIdAfterTimestamp(long timestamp);

    @Query("DELETE FROM measurements")
    void clearAll();
}
