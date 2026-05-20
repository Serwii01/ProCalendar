package com.procalendar.sync;

import com.procalendar.sync.google.GoogleCalendarSyncService;
import com.procalendar.sync.icloud.ICloudCalDavSyncService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * HTTP wrapper around the sync providers so the desktop UI can trigger a sync
 * via the "Sincronizar calendarios" button.
 */
@RestController
@RequestMapping("/api/sync")
@CrossOrigin(origins = "*")
public class SyncController {

    private final GoogleCalendarSyncService google;
    private final ICloudCalDavSyncService icloud;

    public SyncController(GoogleCalendarSyncService google, ICloudCalDavSyncService icloud) {
        this.google = google;
        this.icloud = icloud;
    }

    @GetMapping("/providers")
    public List<Map<String, String>> providers() {
        return List.of(
                Map.of("name", google.name(), "label", "Google Calendar"),
                Map.of("name", icloud.name(), "label", "iCloud")
        );
    }

    @PostMapping("/{provider}")
    public SyncResult sync(@PathVariable String provider,
                           @RequestParam(defaultValue = "full") String mode) {
        CalendarSyncProvider svc = resolve(provider);
        return switch (mode) {
            case "pull" -> svc.pull();
            case "push" -> svc.push();
            case "full" -> svc.fullSync();
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "mode must be pull|push|full");
        };
    }

    private CalendarSyncProvider resolve(String name) {
        return switch (name) {
            case "google" -> google;
            case "icloud" -> icloud;
            default -> throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown provider: " + name);
        };
    }
}
