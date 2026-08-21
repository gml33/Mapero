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
    public static final String DEFAULT_API_KEY = "mapero_dev_key";
    public static final String DEFAULT_PLAYER_NAME = "jugador";

    private static final String PREFS = "server";
    private static final String KEY_URL = "serverUrl";
    private static final String KEY_KEY = "apiKey";
    private static final String KEY_PLAYER = "playerName";
    private static final String KEY_STREAMING = "streaming";

    public String serverUrl;
    public String apiKey;
    public String playerName;
    /** Si true, sube los datos en tiempo real al servidor; si false, solo local. */
    public boolean streaming;

    public ServerConfig() {
        serverUrl = DEFAULT_URL;
        apiKey = DEFAULT_API_KEY;
        playerName = DEFAULT_PLAYER_NAME;
        streaming = true;
    }

    public static ServerConfig load(Context context) {
        ServerConfig c = new ServerConfig();
        SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        c.serverUrl = sp.getString(KEY_URL, DEFAULT_URL);
        c.apiKey = sp.getString(KEY_KEY, DEFAULT_API_KEY);
        c.playerName = sp.getString(KEY_PLAYER, DEFAULT_PLAYER_NAME);
        c.streaming = sp.getBoolean(KEY_STREAMING, true);
        return c;
    }

    public void save(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_URL, serverUrl)
                .putString(KEY_KEY, apiKey)
                .putString(KEY_PLAYER, playerName)
                .putBoolean(KEY_STREAMING, streaming)
                .apply();
    }
}
