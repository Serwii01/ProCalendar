package com.procalendar.sync.google;

import com.fasterxml.jackson.databind.JsonNode;
import com.procalendar.event.CalendarEvent;
import com.procalendar.event.CalendarEventRepository;
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

/**
 * Google Calendar synchronization.
 *
 * Flow:
 *  1. The user logs in via /oauth2/authorization/google (Spring Security OAuth2 client).
 *     Spring stores the access + refresh token in {@link OAuth2AuthorizedClientService}.
 *  2. This service grabs that authorized client and calls Google Calendar API v3.
 *  3. Events are upserted into the local DB keyed by (source=GOOGLE, externalId=eventId).
 *
 * The minimum scope is https://www.googleapis.com/auth/calendar (already in properties).
 */
@Service
public class GoogleCalendarSyncService implements CalendarSyncProvider {

    private static final Logger log = LoggerFactory.getLogger(GoogleCalendarSyncService.class);
    private static final String GCAL_BASE = "https://www.googleapis.com/calendar/v3";

    private final CalendarEventRepository repository;
    private final OAuth2AuthorizedClientService authorizedClientService;
    private final RestClient http = RestClient.builder().build();

    @Value("${procalendar.sync.google.enabled:false}")
    private boolean enabled;

    @Value("${procalendar.sync.google.calendar-id:primary}")
    private String calendarId;

    /** Optional manually-provided OAuth2 access token (for desktop/native flow). */
    @Value("${procalendar.sync.google.access-token:}")
    private String staticAccessToken;

    /** Default last principal that authenticated against Google; populated by OAuth callback. */
    private volatile String lastPrincipal;

    public GoogleCalendarSyncService(CalendarEventRepository repository,
                                     OAuth2AuthorizedClientService authorizedClientService) {
        this.repository = repository;
        this.authorizedClientService = authorizedClientService;
    }

    /** Called from the OAuth success endpoint so subsequent sync calls can find the token. */
    public void rememberPrincipal(String principalName) {
        this.lastPrincipal = principalName;
    }

    @Override public String name() { return "google"; }

    @Override
    public SyncResult pull() {
        if (!enabled) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado (procalendar.sync.google.enabled=false)");
        String token = resolveAccessToken();
        if (token == null) return new SyncResult(name(), 0, 0, 0, 0, "no hay token OAuth, conecta Google primero");

        int imported = 0, updated = 0, skipped = 0;
        try {
            String url = GCAL_BASE + "/calendars/" + encode(calendarId)
                    + "/events?singleEvents=true&orderBy=startTime&maxResults=2500";
            JsonNode root = http.get()
                    .uri(url)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .body(JsonNode.class);

            if (root == null || !root.has("items")) {
                return new SyncResult(name(), 0, 0, 0, 0, "respuesta vacía");
            }
            for (JsonNode item : root.get("items")) {
                if ("cancelled".equals(item.path("status").asText())) { skipped++; continue; }
                String externalId = item.path("id").asText();
                if (externalId.isEmpty()) { skipped++; continue; }

                boolean isNew = repository.findBySourceAndExternalId(CalendarEvent.Source.GOOGLE, externalId).isEmpty();
                upsertFromGoogle(item);
                if (isNew) imported++; else updated++;
            }
            log.info("[google] pull complete imported={} updated={} skipped={}", imported, updated, skipped);
            return new SyncResult(name(), imported, updated, 0, skipped, "pull ok");
        } catch (Exception e) {
            log.error("[google] pull error", e);
            return new SyncResult(name(), imported, updated, 0, skipped, "error: " + e.getMessage());
        }
    }

    @Override
    public SyncResult push() {
        if (!enabled) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");
        String token = resolveAccessToken();
        if (token == null) return new SyncResult(name(), 0, 0, 0, 0, "no hay token OAuth");

        // Push only LOCAL events that haven't been synced yet.
        int pushed = 0, errors = 0;
        for (CalendarEvent ev : repository.findAll()) {
            if (ev.getSource() != CalendarEvent.Source.LOCAL || ev.getExternalId() != null) continue;
            try {
                String body = buildGoogleBody(ev);
                JsonNode resp = http.post()
                        .uri(GCAL_BASE + "/calendars/" + encode(calendarId) + "/events")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .body(JsonNode.class);
                if (resp != null && resp.has("id")) {
                    ev.setSource(CalendarEvent.Source.GOOGLE);
                    ev.setExternalId(resp.get("id").asText());
                    ev.setExternalCalendarId(calendarId);
                    ev.setLastSyncedAt(LocalDateTime.now());
                    repository.save(ev);
                    pushed++;
                }
            } catch (Exception e) {
                log.warn("[google] push failed for event {}: {}", ev.getId(), e.getMessage());
                errors++;
            }
        }
        return new SyncResult(name(), 0, pushed, 0, errors, "push ok");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    private String resolveAccessToken() {
        if (staticAccessToken != null && !staticAccessToken.isBlank()) return staticAccessToken;
        if (lastPrincipal == null) return null;
        OAuth2AuthorizedClient client = authorizedClientService.loadAuthorizedClient("google", lastPrincipal);
        if (client == null) return null;
        return client.getAccessToken().getTokenValue();
    }

    private CalendarEvent upsertFromGoogle(JsonNode item) {
        String externalId = item.path("id").asText();
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.GOOGLE, externalId)
                .orElseGet(CalendarEvent::new);

        ev.setSource(CalendarEvent.Source.GOOGLE);
        ev.setExternalId(externalId);
        ev.setExternalCalendarId(calendarId);
        ev.setTitle(item.path("summary").asText("(sin título)"));
        ev.setDescription(item.path("description").asText(null));
        ev.setLocation(item.path("location").asText(null));

        JsonNode start = item.path("start");
        JsonNode end   = item.path("end");
        boolean allDay = start.hasNonNull("date"); // Google encodes all-day with "date" instead of "dateTime"
        ev.setAllDay(allDay);

        if (allDay) {
            LocalDate sd = LocalDate.parse(start.path("date").asText());
            LocalDate ed = LocalDate.parse(end.path("date").asText()).minusDays(1); // Google end is exclusive
            ev.setStartAt(sd.atStartOfDay());
            ev.setEndAt(ed.atTime(23, 59));
        } else {
            ev.setStartAt(parseDateTime(start.path("dateTime").asText()));
            ev.setEndAt(parseDateTime(end.path("dateTime").asText()));
        }

        ev.setLastSyncedAt(LocalDateTime.now());
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
            String ed = ev.getEndAt().toLocalDate().plusDays(1).toString(); // Google end is exclusive
            sb.append("\"start\":{\"date\":\"").append(sd).append("\"},");
            sb.append("\"end\":{\"date\":\"").append(ed).append("\"}");
        } else {
            sb.append("\"start\":{\"dateTime\":\"").append(ev.getStartAt()).append("\",\"timeZone\":\"")
                    .append(ZoneId.systemDefault().getId()).append("\"},");
            sb.append("\"end\":{\"dateTime\":\"").append(ev.getEndAt()).append("\",\"timeZone\":\"")
                    .append(ZoneId.systemDefault().getId()).append("\"}");
        }
        sb.append('}');
        return sb.toString();
    }

    private static String quote(String s) {
        return "\"" + s.replace("\\","\\\\").replace("\"","\\\"")
                       .replace("\n","\\n").replace("\r","") + "\"";
    }

    private static String encode(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }
}
