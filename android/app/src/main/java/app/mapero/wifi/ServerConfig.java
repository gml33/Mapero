package app.mapero.wifi;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * Configuración del servidor remoto para la sincronización en tiempo real.
 * - serverUrl: URL base de la API (p. ej. http://192.168.0.12:8080).
 * - Credenciales y token almacenados de forma cifrada mediante
 *   EncryptedSharedPreferences (Android Keystore).
 */
public final class ServerConfig {

    public static final String DEFAULT_URL = "http://192.168.0.12:8080";

    private static final String PREFS = "server";
    private static final String KEY_URL = "serverUrl";
    private static final String KEY_USER = "username";
    private static final String KEY_PASS = "password";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_STREAMING = "streaming";
    private static final String KEY_LAST_UPLOADED = "lastUploaded";
    private static final String KEY_LAST_UPLOADED_ID = "lastUploadedId";

    public String serverUrl;
    public String username;
    public String password;
    public String token;
    /** Si true, sube los datos en tiempo real al servidor; si false, solo local. */
    public boolean streaming;
    /**
     * Cursor de subida: id de la última medición que el servidor confirmó.
     *
     * Antes era un timestamp, lo que perdía las mediciones que compartían
     * milisegundo y obligaba a comparar contra el campo de cada fila. Queda
     * guardado por compatibilidad para poder convertirlo una vez.
     */
    public long lastUploadedId;
    /** Cursor viejo (timestamp en ms). 0 = nunca se usó. */
    public long lastUploaded;

    public ServerConfig() {
        serverUrl = DEFAULT_URL;
        username = "";
        password = "";
        token = "";
        streaming = true;
        lastUploadedId = 0L;
        lastUploaded = 0L;
    }

    private static SharedPreferences getEncryptedPrefs(Context context) {
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            return EncryptedSharedPreferences.create(
                    PREFS,
                    masterKeyAlias,
                    context,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            throw new RuntimeException("No se pudo crear EncryptedSharedPreferences", e);
        }
    }

    public static ServerConfig load(Context context) {
        ServerConfig c = new ServerConfig();
        SharedPreferences sp = getEncryptedPrefs(context);
        c.serverUrl = sp.getString(KEY_URL, DEFAULT_URL);
        c.username = sp.getString(KEY_USER, "");
        c.password = sp.getString(KEY_PASS, "");
        c.token = sp.getString(KEY_TOKEN, "");
        c.streaming = sp.getBoolean(KEY_STREAMING, true);
        c.lastUploadedId = sp.getLong(KEY_LAST_UPLOADED_ID, 0L);
        c.lastUploaded = sp.getLong(KEY_LAST_UPLOADED, 0L);
        return c;
    }

    public void save(Context context) {
        SharedPreferences sp = getEncryptedPrefs(context);
        sp.edit()
                .putString(KEY_URL, serverUrl)
                .putString(KEY_USER, username)
                .putString(KEY_PASS, password)
                .putString(KEY_TOKEN, token)
                .putBoolean(KEY_STREAMING, streaming)
                .putLong(KEY_LAST_UPLOADED, lastUploaded)
                .putLong(KEY_LAST_UPLOADED_ID, lastUploadedId)
                .apply();
    }

    public boolean hasToken() {
        return token != null && !token.isEmpty();
    }
}