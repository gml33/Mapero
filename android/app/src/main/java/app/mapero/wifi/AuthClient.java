package app.mapero.wifi;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Cliente de autenticación: intenta login y, si el usuario no existe, lo crea.
 * Devuelve el token de sesión.
 */
public final class AuthClient {

    private AuthClient() {
    }

    public static String loginOrRegister(String baseUrl, String username, String password)
            throws Exception {
        String token = post(baseUrl, "/api/auth/login", username, password);
        if (token == null) {
            token = post(baseUrl, "/api/auth/register", username, password);
        }
        return token;
    }

    private static String post(String baseUrl, String path, String u, String p)
            throws Exception {
        JSONObject body = new JSONObject();
        body.put("username", u);
        body.put("password", p);

        URL url = new URL(baseUrl + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                return null;
            }
            String resp = readAll(conn.getInputStream());
            JSONObject json = new JSONObject(resp);
            return json.optString("token", null);
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream is) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
