package com.procalendar.sync;

import com.procalendar.sync.google.GoogleCalendarSyncService;
import com.procalendar.sync.icloud.ICloudCalDavSyncService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.view.RedirectView;

import java.util.List;
import java.util.Map;

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

    @GetMapping("/status")
    public Map<String, Object> status(Authentication auth) {
        return Map.of(
                "googleAuthenticated", auth != null && auth.isAuthenticated() && auth.getPrincipal() instanceof OAuth2User,
                "principal", auth == null ? "" : auth.getName()
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

    // ── NUEVO ──────────────────────────────────────────────────────────────
    @GetMapping("/icloud/calendars")
    public Map<String, String> icloudCalendars() throws Exception {
        return icloud.discoverCalendarsWithNames();
    }
    // ───────────────────────────────────────────────────────────────────────

    @GetMapping("/oauth-success")
    public RedirectView oauthSuccess(@AuthenticationPrincipal OAuth2User principal,
                                     Authentication auth) {
        if (principal != null && auth != null) {
            google.rememberPrincipal(auth.getName());
        }
        return new RedirectView("/api/sync/oauth-done");
    }

    @GetMapping(value = "/oauth-done", produces = "text/html")
    public String oauthDone() {
        return """
            <!doctype html>
            <html lang="es"><head><meta charset="utf-8"><title>Conectado</title>
            <style>body{font-family:system-ui;background:#f9f9ff;color:#111c2d;
            display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
            .card{background:#fff;padding:32px;border-radius:18px;text-align:center;
            box-shadow:0 12px 40px rgba(17,28,45,.12);max-width:420px}
            h1{color:#4f46e5;margin:0 0 8px}p{color:#464555}</style></head>
            <body><div class="card"><h1>✓ Google conectado</h1>
            <p>Ya puedes cerrar esta pestaña y volver a Pro Calendar.<br>
            Pulsa <b>Sincronizar Google</b> para traer tus eventos.</p></div></body></html>
            """;
    }

    private CalendarSyncProvider resolve(String name) {
        return switch (name) {
            case "google" -> google;
            case "icloud" -> icloud;
            default -> throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown provider: " + name);
        };
    }
}