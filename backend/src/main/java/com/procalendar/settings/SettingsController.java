package com.procalendar.settings;

import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/settings")
@CrossOrigin(origins = "*")
public class SettingsController {

    private final SettingsService settings;

    public SettingsController(SettingsService settings) { this.settings = settings; }

    @GetMapping
    public Map<String, String> all() {
        return settings.snapshotMasked();
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
