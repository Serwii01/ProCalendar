package com.procalendar.sync.google;

import com.fasterxml.jackson.databind.JsonNode;
import com.procalendar.event.CalendarEvent;
import com.procalendar.event.CalendarEventRepository;
import com.procalendar.settings.SettingsService;
import com.procalendar.sync.CalendarSyncProvider;
import com.procalendar.sync.SyncResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Google Calendar synchronization.
 */
@Service
public class GoogleCalendarSyncService implements CalendarSyncProvider {

    private static final Logger log = LoggerFactory.getLogger(GoogleCalendarSyncService.class);
    private static final String GCAL_BASE = "https://www.googleapis.com/calendar/v3";

    private final CalendarEventRepository repository;
    private final OAuth2AuthorizedClientService authorizedClientService;
    private final SettingsService settings;
    private final GoogleTokenStore tokenStore;
    private final RestClient http = RestClient.builder().build();

    @Value("${procalendar.sync.google.enabled:false}")
    private boolean enabledProp;

    @Value("${procalendar.sync.google.calendar-id:primary}")
    private String calendarIdProp;

    @Value("${procalendar.sync.google.access-token:}")
    private String staticAccessToken;

    @Value("${spring.security.oauth2.client.registration.google.client-id:}")
    private String fallbackClientId;
    @Value("${spring.security.oauth2.client.registration.google.client-secret:}")
    private String fallbackClientSecret;

    private volatile String lastPrincipal;
    private volatile List<CalendarInfo> discoveredCalendars;

    public record CalendarInfo(String name, String id, String color) {}

    public GoogleCalendarSyncService(CalendarEventRepository repository,
                                     OAuth2AuthorizedClientService authorizedClientService,
                                     SettingsService settings,
                                     GoogleTokenStore tokenStore) {
        this.repository = repository;
        this.authorizedClientService = authorizedClientService;
        this.settings = settings;
        this.tokenStore = tokenStore;
    }

    private boolean enabled() { return settings.getBool(SettingsService.GOOGLE_ENABLED, enabledProp); }

    public void rememberPrincipal(String principalName) {
        this.lastPrincipal = principalName;
    }

    /** Un id de calendario Google nunca es una URL (los href de iCloud sí). */
    private static boolean isGoogleCalendarId(String id) {
        return id != null && !id.isBlank() && !id.startsWith("http");
    }

    @Override public String name() { return "google"; }

    @Override
    public SyncResult pull() {
        if (!enabled()) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");
        String token = resolveAccessToken();
        if (token == null) return new SyncResult(name(), 0, 0, 0, 0, "no hay token OAuth");

        List<CalendarInfo> cals = resolveAllCalendars(token);
        if (cals.isEmpty()) return new SyncResult(name(), 0, 0, 0, 0, "no se encontraron calendarios");

        int imported = 0, updated = 0, skipped = 0;
        for (CalendarInfo cal : cals) {
            try {
                String url = GCAL_BASE + "/calendars/" + encode(cal.id())
                        + "/events?singleEvents=true&orderBy=startTime&maxResults=2500";
                JsonNode root = http.get()
                        .uri(url)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .accept(MediaType.APPLICATION_JSON)
                        .retrieve()
                        .body(JsonNode.class);

                if (root == null || !root.has("items")) continue;

                for (JsonNode item : root.get("items")) {
                    if ("cancelled".equals(item.path("status").asText())) { skipped++; continue; }
                    String externalId = item.path("id").asText();
                    if (externalId.isEmpty()) { skipped++; continue; }

                    boolean isNew = repository.findBySourceAndExternalId(CalendarEvent.Source.GOOGLE, externalId).isEmpty();
                    upsertFromGoogle(item, cal);
                    if (isNew) imported++; else updated++;
                }
            } catch (Exception e) {
                log.error("[google] pull error for {}: {}", cal.name(), e.getMessage());
            }
        }
        return new SyncResult(name(), imported, updated, 0, skipped, "pull ok (" + cals.size() + " calendarios)");
    }

    @Override
    public SyncResult push() {
        if (!enabled()) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");
        String token = resolveAccessToken();
        if (token == null) return new SyncResult(name(), 0, 0, 0, 0, "no hay token OAuth");

        int created = 0, updated = 0, errors = 0;
        String fallbackId = "primary";

        for (CalendarEvent ev : repository.findAll()) {
            // Case A: Create new local event on Google.
            // SOLO si el usuario asignó explícitamente un calendario Google al evento.
            // (sin fallback: "Solo local" significa que NO se sube a ningún sitio,
            //  y los href de iCloud — URLs — los gestiona el provider de iCloud)
            if (ev.getSource() == CalendarEvent.Source.LOCAL && ev.getExternalId() == null) {
                if (!isGoogleCalendarId(ev.getExternalCalendarId())) continue;
                String targetId = ev.getExternalCalendarId();

                try {
                    String body = buildGoogleBody(ev);
                    JsonNode resp = http.post()
                            .uri(GCAL_BASE + "/calendars/" + encode(targetId) + "/events")
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(body)
                            .retrieve()
                            .body(JsonNode.class);

                    if (resp != null && resp.has("id")) {
                        ev.setSource(CalendarEvent.Source.GOOGLE);
                        ev.setExternalId(resp.get("id").asText());
                        ev.setExternalCalendarId(targetId);
                        ev.setLastSyncedAt(LocalDateTime.now());
                        ev.setDirty(false);
                        repository.save(ev);
                        created++;
                    }
                } catch (Exception e) {
                    log.warn("[google] push create failed for event {}: {}", ev.getId(), e.getMessage());
                    errors++;
                }
                continue;
            }

            // Case B: Update existing Google event with local changes
            if (ev.getSource() == CalendarEvent.Source.GOOGLE && ev.isDirty() && ev.getExternalId() != null) {
                String calId = ev.getExternalCalendarId() != null ? ev.getExternalCalendarId() : fallbackId;
                try {
                    String body = buildGoogleBody(ev);
                    JsonNode resp = http.patch()
                            .uri(GCAL_BASE + "/calendars/" + encode(calId) + "/events/" + encode(ev.getExternalId()))
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(body)
                            .retrieve()
                            .body(JsonNode.class);

                    if (resp != null && resp.has("id")) {
                        ev.setLastSyncedAt(LocalDateTime.now());
                        ev.setDirty(false);
                        repository.save(ev);
                        updated++;
                    }
                } catch (Exception e) {
                    log.warn("[google] push update failed for event {}: {}", ev.getId(), e.getMessage());
                    errors++;
                }
            }
        }
        return new SyncResult(name(), 0, created + updated, 0, errors, 
                String.format("push: %d creados, %d actualizados", created, updated));
    }

    public boolean deleteRemote(CalendarEvent ev) {
        if (!enabled()) return false;
        String token = resolveAccessToken();
        if (token == null || ev.getExternalId() == null) return false;
        
        String calId = ev.getExternalCalendarId() != null ? ev.getExternalCalendarId() : "primary";
        try {
            http.delete()
                .uri(GCAL_BASE + "/calendars/" + encode(calId) + "/events/" + encode(ev.getExternalId()))
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .retrieve()
                .toBodilessEntity();
            return true;
        } catch (Exception e) {
            log.error("[google] delete remote failed: {}", e.getMessage());
            return false;
        }
    }

    public List<CalendarInfo> discoverCalendarsWithMeta() {
        String token = resolveAccessToken();
        if (token == null) return List.of();

        try {
            JsonNode root = http.get()
                    .uri(GCAL_BASE + "/users/me/calendarList")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .retrieve()
                    .body(JsonNode.class);

            List<CalendarInfo> result = new ArrayList<>();
            if (root != null && root.has("items")) {
                for (JsonNode item : root.get("items")) {
                    String id = item.path("id").asText();
                    String name = item.path("summary").asText(id);
                    String color = item.path("backgroundColor").asText(null);
                    result.add(new CalendarInfo(name, id, color));
                }
            }
            this.discoveredCalendars = result;
            return result;
        } catch (Exception e) {
            log.error("[google] discovery failed", e);
            return List.of();
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    private String resolveAccessToken() {
        if (staticAccessToken != null && !staticAccessToken.isBlank()) return staticAccessToken;

        // 1) Token store persistente (sobrevive reinicios; se auto-renueva con el refresh token)
        String clientId     = settings.get(SettingsService.GOOGLE_CLIENT_ID, fallbackClientId);
        String clientSecret = settings.get(SettingsService.GOOGLE_CLIENT_SECRET, fallbackClientSecret);
        String token = tokenStore.getValidAccessToken(clientId, clientSecret);
        if (token != null) return token;

        // 2) Fallback: sesión OAuth en memoria de Spring (mismo arranque)
        if (lastPrincipal == null) return null;
        OAuth2AuthorizedClient client = authorizedClientService.loadAuthorizedClient("google", lastPrincipal);
        if (client == null) return null;
        return client.getAccessToken().getTokenValue();
    }

    private List<CalendarInfo> resolveAllCalendars(String token) {
        if (discoveredCalendars != null && !discoveredCalendars.isEmpty()) return discoveredCalendars;
        return discoverCalendarsWithMeta();
    }

    private CalendarEvent upsertFromGoogle(JsonNode item, CalendarInfo cal) {
        String externalId = item.path("id").asText();
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.GOOGLE, externalId)
                .orElseGet(CalendarEvent::new);

        ev.setSource(CalendarEvent.Source.GOOGLE);
        ev.setExternalId(externalId);
        ev.setExternalCalendarId(cal.id());
        ev.setCalendarName(cal.name());
        if (cal.color() != null && (ev.getColor() == null || ev.getColor().startsWith("#"))) {
            ev.setColor(cal.color());
        }
        
        ev.setTitle(item.path("summary").asText("(sin título)"));
        ev.setDescription(item.path("description").asText(null));
        ev.setLocation(item.path("location").asText(null));

        JsonNode start = item.path("start");
        JsonNode end   = item.path("end");
        boolean allDay = start.hasNonNull("date");
        ev.setAllDay(allDay);

        if (allDay) {
            LocalDate sd = LocalDate.parse(start.path("date").asText());
            LocalDate ed = LocalDate.parse(end.path("date").asText()).minusDays(1);
            ev.setStartAt(sd.atStartOfDay());
            ev.setEndAt(ed.atTime(23, 59));
        } else {
            ev.setStartAt(parseDateTime(start.path("dateTime").asText()));
            ev.setEndAt(parseDateTime(end.path("dateTime").asText()));
        }

        ev.setLastSyncedAt(LocalDateTime.now());
        ev.setDirty(false); // pull is authoritative
        return repository.save(ev);
    }

    private LocalDateTime parseDateTime(String iso) {
        try {
            return OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
        } catch (DateTimeParseException ex) {
            return LocalDateTime.parse(iso);
        }
    }

    private String buildGoogleBody(CalendarEvent ev) {
        StringBuilder sb = new StringBuilder("{");
        sb.append("\"summary\":").append(quote(ev.getTitle())).append(',');
        if (ev.getDescription() != null) sb.append("\"description\":").append(quote(ev.getDescription())).append(',');
        if (ev.getLocation() != null)    sb.append("\"location\":").append(quote(ev.getLocation())).append(',');

        if (ev.isAllDay()) {
            String sd = ev.getStartAt().toLocalDate().toString();
            String ed = ev.getEndAt().toLocalDate().plusDays(1).toString();
            sb.append("\"start\":{\"date\":\"").append(sd).append("\"},");
            sb.append("\"end\":{\"date\":\"").append(ed).append("\"}");
        } else {
            // Las horas locales se envían con el offset REAL del sistema (antes se
            // marcaban como UTC con "Z", desplazando los eventos 1-2 horas).
            java.time.format.DateTimeFormatter iso = java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME;
            String start = ev.getStartAt().atZone(ZoneId.systemDefault()).format(iso);
            String end   = ev.getEndAt().atZone(ZoneId.systemDefault()).format(iso);
            sb.append("\"start\":{\"dateTime\":\"").append(start).append("\"},");
            sb.append("\"end\":{\"dateTime\":\"").append(end).append("\"}");
        }
        sb.append('}');
        return sb.toString();
    }

    private static String quote(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\","\\\\").replace("\"","\\\"")
                       .replace("\n","\\n").replace("\r","") + "\"";
    }

    private static String encode(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }
}
