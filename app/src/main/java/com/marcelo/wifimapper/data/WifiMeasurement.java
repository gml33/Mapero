package com.marcelo.wifimapper.data;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

@Entity(tableName = "measurements",
        indices = {@Index(value = "bssid")})
public class WifiMeasurement {

    @PrimaryKey(autoGenerate = true)
    public long id;

    @NonNull
    @ColumnInfo(name = "bssid")
    public String bssid;

    @ColumnInfo(name = "ssid")
    public String ssid;

    @ColumnInfo(name = "latitude")
    public double latitude;

    @ColumnInfo(name = "longitude")
    public double longitude;

    @ColumnInfo(name = "rssi")
    public int rssi;

    @ColumnInfo(name = "frequency")
    public int frequency;

    @ColumnInfo(name = "timestamp")
    public long timestamp;
}
