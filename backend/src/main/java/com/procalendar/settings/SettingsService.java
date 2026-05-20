package com.procalendar.settings;

import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/** Centralized read/write for app settings. Values are nullable. */
@Service
public class SettingsService {

    public static final String GOOGLE_CLIENT_ID     = "google.clientId";
    public static final String GOOGLE_CLIENT_SECRET = "google.clientSecret";
    public static final String GOOGLE_ENABLED       = "google.enabled";

    public static final String ICLOUD_APPLE_ID      = "icloud.appleId";
    public static final String ICLOUD_APP_PASSWORD  = "icloud.appPassword";
    public static final String ICLOUD_CALENDAR_URL  = "icloud.calendarUrl";
    public static final String ICLOUD_ENABLED       = "icloud.enabled";

    public static final String AUTO_SYNC_ENABLED    = "sync.autoEnabled";
    public static final String AUTO_SYNC_MINUTES    = "sync.autoMinutes";
    public static final String THEME                = "ui.theme"; // light|dark|auto

    private final SettingRepository repo;

    public SettingsService(SettingRepository repo) { this.repo = repo; }

    public String get(String key)            { return repo.findById(key).map(Setting::getValue).orElse(null); }
    public String get(String key, String def){ String v = get(key); return v == null ? def : v; }
    public boolean getBool(String key, boolean def) {
        String v = get(key); return v == null ? def : Boolean.parseBoolean(v);
    }
    public int getInt(String key, int def) {
        String v = get(key); try { return v == null ? def : Integer.parseInt(v); } catch (Exception e) { return def; }
    }

    public void put(String key, String value) {
        if (value == null) { repo.deleteById(key); return; }
        repo.save(new Setting(key, value));
    }

    /** Returns all settings, masking secret fields. */
    public Map<String, String> snapshotMasked() {
        Map<String, String> out = new HashMap<>();
        for (Setting s : repo.findAll()) {
            if (s.getKey().toLowerCase().contains("password") || s.getKey().toLowerCase().contains("secret")) {
                out.put(s.getKey(), s.getValue() == null || s.getValue().isEmpty() ? "" : "••••••••");
            } else {
                out.put(s.getKey(), s.getValue());
            }
        }
        return out;
    }
}
