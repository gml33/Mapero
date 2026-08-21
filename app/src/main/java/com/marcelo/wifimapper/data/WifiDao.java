package com.marcelo.wifimapper.data;

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

    @Query("DELETE FROM measurements")
    void clearAll();
}
