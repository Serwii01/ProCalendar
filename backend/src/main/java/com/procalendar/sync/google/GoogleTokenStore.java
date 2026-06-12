package com.procalendar.sync.google;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.procalendar.settings.SettingsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/**
 * Almacén de tokens de Google.
 * - El refresh token se PERSISTE en la BD (tabla app_setting) para sobrevivir reinicios.
 * - El access token vive en memoria y se renueva automáticamente cuando caduca.
 */
@Component
public class GoogleTokenStore {

    private static final Logger log = LoggerFactory.getLogger(GoogleTokenStore.class);
    private static final String TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

    /** Clave en app_setting donde se persiste el refresh token. */
    public static final String KEY_REFRESH_TOKEN = "google.refreshToken";

    private final SettingsService settings;
    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    private volatile String accessToken;
    private volatile Instant expiresAt;

    public GoogleTokenStore(SettingsService settings) {
        this.settings = settings;
    }

    /** Guarda tokens tras un login OAuth correcto. El refresh token va a BD. */
    public synchronized void save(String accessToken, String refreshToken, Instant expiresAt) {
        this.accessToken = accessToken;
        this.expiresAt = expiresAt;
        if (refreshToken != null && !refreshToken.isBlank()) {
            settings.put(KEY_REFRESH_TOKEN, refreshToken);
            log.info("[google] refresh token persistido");
        }
    }

    /** Compatibilidad con el flujo antiguo (sin expiry conocido: asume 50 min). */
    public synchronized void save(String accessToken, String refreshToken) {
        save(accessToken, refreshToken, Instant.now().plusSeconds(3000));
    }

    public String getRefreshToken() { return settings.get(KEY_REFRESH_TOKEN); }

    /** ¿Hay alguna credencial utilizable (access vigente o refresh persistido)? */
    public boolean hasToken() {
        if (accessToken != null && expiresAt != null && Instant.now().isBefore(expiresAt)) return true;
        String rt = getRefreshToken();
        return rt != null && !rt.isBlank();
    }

    public synchronized void clear() {
        this.accessToken = null;
        this.expiresAt = null;
        settings.put(KEY_REFRESH_TOKEN, null);
    }

    /**
     * Devuelve un access token válido, renovándolo con el refresh token si hace falta.
     * @return token o null si no hay credenciales / el refresh falla.
     */
    public synchronized String getValidAccessToken(String clientId, String clientSecret) {
        if (accessToken != null && expiresAt != null
                && Instant.now().isBefore(expiresAt.minusSeconds(60))) {
            return accessToken;
        }
        String refreshToken = getRefreshToken();
        if (refreshToken == null || refreshToken.isBlank()) return null;
        if (clientId == null || clientId.isBlank()) return null;

        try {
            String body = "grant_type=refresh_token"
                    + "&refresh_token=" + url(refreshToken)
                    + "&client_id=" + url(clientId)
                    + "&client_secret=" + url(clientSecret == null ? "" : clientSecret);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(TOKEN_ENDPOINT))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

            if (res.statusCode() / 100 != 2) {
                log.warn("[google] refresh de token falló: HTTP {} {}", res.statusCode(), truncate(res.body()));
                // invalid_grant => el refresh token fue revocado: lo limpiamos para forzar re-login
                if (res.body() != null && res.body().contains("invalid_grant")) {
                    log.warn("[google] refresh token revocado, se requiere volver a conectar la cuenta");
                    settings.put(KEY_REFRESH_TOKEN, null);
                }
                return null;
            }

            JsonNode json = mapper.readTree(res.body());
            this.accessToken = json.path("access_token").asText(null);
            long expiresIn = json.path("expires_in").asLong(3600);
            this.expiresAt = Instant.now().plusSeconds(expiresIn);
            // Google a veces rota el refresh token
            String newRefresh = json.path("refresh_token").asText(null);
            if (newRefresh != null && !newRefresh.isBlank()) settings.put(KEY_REFRESH_TOKEN, newRefresh);

            log.info("[google] access token renovado (caduca en {}s)", expiresIn);
            return this.accessToken;
        } catch (Exception e) {
            log.warn("[google] error renovando token: {}", e.getMessage());
            return null;
        }
    }

    private static String url(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
    private static String truncate(String s) {
        if (s == null) return "";
        return s.length() > 200 ? s.substring(0, 200) : s;
    }
}
