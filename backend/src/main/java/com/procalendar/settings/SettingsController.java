package com.procalendar.settings;

import com.procalendar.sync.icloud.ICloudCalDavSyncService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/settings")
@CrossOrigin(origins = "*")
public class SettingsController {

    private final SettingsService settings;
    private final ICloudCalDavSyncService icloud;
    private final com.procalendar.sync.google.GoogleTokenStore googleTokens;

    @Value("${procalendar.sync.icloud.enabled:false}")  private boolean propIcloudEnabled;
    @Value("${procalendar.sync.icloud.apple-id:}")      private String  propIcloudAppleId;
    @Value("${procalendar.sync.icloud.calendar-url:}")  private String  propIcloudUrl;
    @Value("${procalendar.sync.google.enabled:false}")  private boolean propGoogleEnabled;

    public SettingsController(SettingsService settings, ICloudCalDavSyncService icloud,
                              com.procalendar.sync.google.GoogleTokenStore googleTokens) {
        this.settings = settings;
        this.icloud = icloud;
        this.googleTokens = googleTokens;
    }

    /** Returns effective settings: DB value OR property fallback. So the UI shows
     *  the REAL state, not just what's in DB. */
    @GetMapping
    public Map<String, String> all() {
        Map<String, String> snap = new LinkedHashMap<>(settings.snapshotMasked());
        snap.putIfAbsent(SettingsService.ICLOUD_ENABLED,    String.valueOf(propIcloudEnabled));
        snap.putIfAbsent(SettingsService.ICLOUD_APPLE_ID,   propIcloudAppleId);
        snap.putIfAbsent(SettingsService.ICLOUD_CALENDAR_URL, propIcloudUrl);
        snap.putIfAbsent(SettingsService.GOOGLE_ENABLED,    String.valueOf(propGoogleEnabled));
        snap.putIfAbsent(SettingsService.AUTO_SYNC_ENABLED, "true");
        snap.putIfAbsent(SettingsService.AUTO_SYNC_MINUTES, "5");
        return snap;
    }

    /** Bulk update. Values "" delete the key. Masked placeholder "••••••••" is ignored. */
    @PutMapping
    public Map<String, String> update(@RequestBody Map<String, String> patch) {
        boolean touchedIcloud = false;
        boolean changedGoogleClient = false;
        for (Map.Entry<String, String> e : patch.entrySet()) {
            String k = e.getKey();
            String v = e.getValue();
            if (v != null && v.contains("••••")) continue;       // ignore masked placeholder
            if (SettingsService.GOOGLE_CLIENT_ID.equals(k)) {
                String prev = settings.get(SettingsService.GOOGLE_CLIENT_ID, "");
                String next = v == null ? "" : v;
                if (!prev.equals(next) && !next.isEmpty()) changedGoogleClient = true;
            }
            settings.put(k, v == null || v.isEmpty() ? null : v);
            if (k.startsWith("icloud.")) touchedIcloud = true;
        }
        if (touchedIcloud) icloud.invalidateCache();              // refresca discovery
        // Si cambió el OAuth client, los tokens del client anterior ya no sirven.
        if (changedGoogleClient) googleTokens.clear();
        return settings.snapshotMasked();
    }
}
