package app.mapero.wifi;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Configuración del servidor remoto para la sincronización en tiempo real.
 * - serverUrl: URL base de la API (p. ej. http://192.168.0.12:8080).
 * - apiKey: clave de escritura usada por el servidor.
 */
public final class ServerConfig {

    public static final String DEFAULT_URL = "http://192.168.0.12:8080";

    private static final String PREFS = "server";
    private static final String KEY_URL = "serverUrl";
    private static final String KEY_USER = "username";
    private static final String KEY_PASS = "password";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_STREAMING = "streaming";

    public String serverUrl;
    public String username;
    public String password;
    public String token;
    /** Si true, sube los datos en tiempo real al servidor; si false, solo local. */
    public boolean streaming;

    public ServerConfig() {
        serverUrl = DEFAULT_URL;
        username = "";
        password = "";
        token = "";
        streaming = true;
    }

    public static ServerConfig load(Context context) {
        ServerConfig c = new ServerConfig();
        SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        c.serverUrl = sp.getString(KEY_URL, DEFAULT_URL);
        c.username = sp.getString(KEY_USER, "");
        c.password = sp.getString(KEY_PASS, "");
        c.token = sp.getString(KEY_TOKEN, "");
        c.streaming = sp.getBoolean(KEY_STREAMING, true);
        return c;
    }

    public void save(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_URL, serverUrl)
                .putString(KEY_USER, username)
                .putString(KEY_PASS, password)
                .putString(KEY_TOKEN, token)
                .putBoolean(KEY_STREAMING, streaming)
                .apply();
    }

    public boolean hasToken() {
        return token != null && !token.isEmpty();
    }
}
