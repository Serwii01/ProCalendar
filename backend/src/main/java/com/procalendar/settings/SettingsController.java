package com.procalendar.settings;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/settings")
@CrossOrigin(origins = "*")
public class SettingsController {

    private final SettingsService settings;

    @Value("${procalendar.sync.icloud.enabled:false}")  private boolean propIcloudEnabled;
    @Value("${procalendar.sync.icloud.apple-id:}")      private String  propIcloudAppleId;
    @Value("${procalendar.sync.icloud.calendar-url:}")  private String  propIcloudUrl;
    @Value("${procalendar.sync.google.enabled:false}")  private boolean propGoogleEnabled;

    public SettingsController(SettingsService settings) { this.settings = settings; }

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
        patch.forEach((k, v) -> {
            if (v != null && v.contains("••••")) return;   // ignore masked placeholder
            settings.put(k, v == null || v.isEmpty() ? null : v);
        });
        return settings.snapshotMasked();
    }
}
