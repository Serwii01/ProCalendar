package com.procalendar.sync.icloud;

import com.procalendar.event.CalendarEvent;
import com.procalendar.event.CalendarEventRepository;
import com.procalendar.sync.CalendarSyncProvider;
import com.procalendar.sync.SyncResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class ICloudCalDavSyncService implements CalendarSyncProvider {

    private static final Logger log = LoggerFactory.getLogger(ICloudCalDavSyncService.class);
    private static final String CALENDAR_QUERY_BODY = """
            <?xml version="1.0" encoding="utf-8" ?>
            <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
              <D:prop>
                <D:getetag/>
                <C:calendar-data/>
              </D:prop>
              <C:filter>
                <C:comp-filter name="VCALENDAR">
                  <C:comp-filter name="VEVENT"/>
                </C:comp-filter>
              </C:filter>
            </C:calendar-query>
            """;

    private final CalendarEventRepository repository;
    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    @Value("${procalendar.sync.icloud.enabled:false}") private boolean enabled;
    @Value("${procalendar.sync.icloud.apple-id:}")     private String appleId;
    @Value("${procalendar.sync.icloud.app-password:}") private String appPassword;
    @Value("${procalendar.sync.icloud.calendar-url:}") private String calendarUrl;

    /** Caché de todos los calendarios descubiertos: nombre → URL */
    private volatile Map<String, String> discoveredCalendars;

    public ICloudCalDavSyncService(CalendarEventRepository repository) {
        this.repository = repository;
    }

    @Override public String name() { return "icloud"; }

    // -----------------------------------------------------------------------
    // PULL — lee TODOS los calendarios de iCloud
    // -----------------------------------------------------------------------
    @Override
    public SyncResult pull() {
        if (!enabled) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");
        if (appleId.isBlank() || appPassword.isBlank())
            return new SyncResult(name(), 0, 0, 0, 0, "faltan apple-id / app-password");

        // Obtener lista de URLs a leer
        List<String> urls = resolveAllUrls();
        if (urls.isEmpty()) return new SyncResult(name(), 0, 0, 0, 0, "no se encontraron calendarios");

        String basic = buildBasic();
        int imported = 0, updated = 0, skipped = 0;

        for (String url : urls) {
            log.info("[icloud] pulling from: {}", url);
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .header("Authorization", "Basic " + basic)
                        .header("Content-Type", "application/xml; charset=utf-8")
                        .header("Depth", "1")
                        .method("REPORT", HttpRequest.BodyPublishers.ofString(CALENDAR_QUERY_BODY, StandardCharsets.UTF_8))
                        .build();

                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (res.statusCode() / 100 != 2) {
                    log.warn("[icloud] HTTP {} for {}", res.statusCode(), url);
                    continue;
                }

                Document doc = parseXml(res.body());
                NodeList datas = doc.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar-data");
                for (int i = 0; i < datas.getLength(); i++) {
                    String ics = datas.item(i).getTextContent();
                    ParsedVEvent v = parseVEvent(ics);
                    if (v == null || v.uid == null || v.summary == null || v.dtstart == null) { skipped++; continue; }
                    boolean isNew = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, v.uid).isEmpty();
                    upsertFromIcs(v, url);
                    if (isNew) imported++; else updated++;
                }
            } catch (Exception e) {
                log.error("[icloud] pull error for {}: {}", url, e.getMessage());
            }
        }
        return new SyncResult(name(), imported, updated, 0, skipped, "pull ok (" + urls.size() + " calendarios)");
    }

    // -----------------------------------------------------------------------
    // PUSH — sube eventos locales al calendario configurado (el primero si no hay url fija)
    // -----------------------------------------------------------------------
    @Override
    public SyncResult push() {
        if (!enabled) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");

        String targetUrl = calendarUrl.isBlank() ? getFirstDiscoveredUrl() : calendarUrl;
        if (targetUrl == null || targetUrl.isBlank())
            return new SyncResult(name(), 0, 0, 0, 0, "falta calendar-url");

        int pushed = 0, errors = 0;
        String basic = buildBasic();

        for (CalendarEvent ev : repository.findAll()) {
            if (ev.getSource() != CalendarEvent.Source.LOCAL || ev.getExternalId() != null) continue;
            String uid = "procal-" + ev.getId() + "@local";
            String ics = buildVCalendar(uid, ev);
            String href = targetUrl + (targetUrl.endsWith("/") ? "" : "/") + uid + ".ics";
            try {
                HttpRequest put = HttpRequest.newBuilder()
                        .uri(URI.create(href))
                        .header("Authorization", "Basic " + basic)
                        .header("Content-Type", "text/calendar; charset=utf-8")
                        .header("If-None-Match", "*")
                        .PUT(HttpRequest.BodyPublishers.ofString(ics, StandardCharsets.UTF_8))
                        .build();
                HttpResponse<String> r = http.send(put, HttpResponse.BodyHandlers.ofString());
                if (r.statusCode() / 100 == 2) {
                    ev.setSource(CalendarEvent.Source.ICLOUD);
                    ev.setExternalId(uid);
                    ev.setExternalCalendarId(targetUrl);
                    ev.setLastSyncedAt(LocalDateTime.now());
                    repository.save(ev);
                    pushed++;
                } else {
                    errors++;
                }
            } catch (Exception e) {
                log.warn("[icloud] push failed for event {}: {}", ev.getId(), e.getMessage());
                errors++;
            }
        }
        return new SyncResult(name(), 0, pushed, 0, errors, "push ok");
    }

    // -----------------------------------------------------------------------
    // Discovery público — devuelve nombre → URL para el endpoint REST
    // -----------------------------------------------------------------------
    public Map<String, String> discoverCalendarsWithNames() throws Exception {
        String basic = buildBasic();

        String principal = propfindSingle("https://caldav.icloud.com/", basic, "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:">
                  <D:prop><D:current-user-principal/></D:prop>
                </D:propfind>
                """, "DAV:", "current-user-principal");
        if (principal == null) throw new RuntimeException("principal no encontrado");
        String principalUrl = absolutize("https://caldav.icloud.com/", principal);

        String homeSet = propfindSingle(principalUrl, basic, "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                  <D:prop><C:calendar-home-set/></D:prop>
                </D:propfind>
                """, "urn:ietf:params:xml:ns:caldav", "calendar-home-set");
        if (homeSet == null) throw new RuntimeException("calendar-home-set no encontrado");
        String homeUrl = absolutize(principalUrl, homeSet);

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(homeUrl))
                .header("Authorization", "Basic " + basic)
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "1")
                .method("PROPFIND", HttpRequest.BodyPublishers.ofString("""
                        <?xml version="1.0" encoding="utf-8" ?>
                        <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                          <D:prop>
                            <D:resourcetype/>
                            <D:displayname/>
                            <C:supported-calendar-component-set/>
                          </D:prop>
                        </D:propfind>
                        """, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() / 100 != 2) throw new RuntimeException("HTTP " + res.statusCode());

        Document doc = parseXml(res.body());
        NodeList responses = doc.getElementsByTagNameNS("DAV:", "response");
        Map<String, String> result = new LinkedHashMap<>();

        for (int i = 0; i < responses.getLength(); i++) {
            Element r = (Element) responses.item(i);
            NodeList rtype = r.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar");
            if (rtype.getLength() == 0) continue;

            NodeList comps = r.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "comp");
            boolean hasVevent = false;
            for (int j = 0; j < comps.getLength(); j++) {
                if ("VEVENT".equalsIgnoreCase(((Element) comps.item(j)).getAttribute("name"))) {
                    hasVevent = true; break;
                }
            }
            if (!hasVevent) continue;

            NodeList hrefs = r.getElementsByTagNameNS("DAV:", "href");
            NodeList names = r.getElementsByTagNameNS("DAV:", "displayname");
            if (hrefs.getLength() == 0) continue;

            String url  = absolutize(homeUrl, hrefs.item(0).getTextContent().trim());
            String name = names.getLength() > 0 ? names.item(0).getTextContent().trim() : url;
            result.put(name, url);
            log.info("[icloud] calendario encontrado: '{}' -> {}", name, url);
        }

        this.discoveredCalendars = result;
        return result;
    }

    /** Mantiene compatibilidad con el método original que devuelve solo URLs */
    public List<String> discoverCalendars() throws Exception {
        return new ArrayList<>(discoverCalendarsWithNames().values());
    }

    // -----------------------------------------------------------------------
    // Helpers internos
    // -----------------------------------------------------------------------
    private List<String> resolveAllUrls() {
        // Si hay URL fija en config, úsala sola (comportamiento legacy)
        if (!calendarUrl.isBlank()) return List.of(calendarUrl);

        // Si ya tenemos el discovery en caché, úsalo
        if (discoveredCalendars != null && !discoveredCalendars.isEmpty())
            return new ArrayList<>(discoveredCalendars.values());

        // Auto-discover ahora
        try {
            Map<String, String> found = discoverCalendarsWithNames();
            return new ArrayList<>(found.values());
        } catch (Exception e) {
            log.error("[icloud] auto-discovery failed: {}", e.getMessage());
            return List.of();
        }
    }

    private String getFirstDiscoveredUrl() {
        if (discoveredCalendars != null && !discoveredCalendars.isEmpty())
            return discoveredCalendars.values().iterator().next();
        try {
            List<String> urls = discoverCalendars();
            return urls.isEmpty() ? null : urls.get(0);
        } catch (Exception e) { return null; }
    }

    private String buildBasic() {
        return Base64.getEncoder().encodeToString(
                (appleId + ":" + appPassword).getBytes(StandardCharsets.UTF_8));
    }

    // -----------------------------------------------------------------------
    // VEVENT parsing (sin cambios)
    // -----------------------------------------------------------------------
    private static final DateTimeFormatter ICS_DATETIME = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
    private static final DateTimeFormatter ICS_DATE     = DateTimeFormatter.ofPattern("yyyyMMdd");

    private static class ParsedVEvent {
        String uid, summary, description, location;
        LocalDateTime dtstart, dtend;
        boolean allDay;
    }

    static ParsedVEvent parseVEvent(String ics) {
        String[] raw = ics.split("\\r?\\n");
        StringBuilder all = new StringBuilder();
        for (String line : raw) {
            if (!all.isEmpty() && (line.startsWith(" ") || line.startsWith("\t"))) {
                all.append(line.substring(1));
            } else {
                if (!all.isEmpty()) all.append('\n');
                all.append(line);
            }
        }
        String[] lines = all.toString().split("\n");
        boolean inEvent = false;
        ParsedVEvent v = new ParsedVEvent();
        for (String line : lines) {
            if (line.startsWith("BEGIN:VEVENT")) { inEvent = true; continue; }
            if (line.startsWith("END:VEVENT"))   { return v; }
            if (!inEvent) continue;
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String head = line.substring(0, colon);
            String val  = unescape(line.substring(colon + 1));
            String name = head.contains(";") ? head.substring(0, head.indexOf(';')) : head;
            switch (name) {
                case "UID"         -> v.uid = val;
                case "SUMMARY"     -> v.summary = val;
                case "DESCRIPTION" -> v.description = val;
                case "LOCATION"    -> v.location = val;
                case "DTSTART"     -> { LocalDateTime[] r = parseIcsDate(head, val); v.dtstart = r[0]; v.allDay = r[1] == null; }
                case "DTEND"       -> { LocalDateTime[] r = parseIcsDate(head, val); v.dtend   = r[0]; }
                default -> {}
            }
        }
        return null;
    }

    private static LocalDateTime[] parseIcsDate(String head, String val) {
        boolean isDate = head.contains("VALUE=DATE") && !head.contains("VALUE=DATE-TIME");
        if (isDate) {
            LocalDate d = LocalDate.parse(val, ICS_DATE);
            return new LocalDateTime[]{ d.atStartOfDay(), null };
        }
        if (val.endsWith("Z")) {
            Instant in = LocalDateTime.parse(val.substring(0, val.length()-1), ICS_DATETIME)
                    .toInstant(ZoneOffset.UTC);
            return new LocalDateTime[]{ in.atZone(ZoneId.systemDefault()).toLocalDateTime(), LocalDateTime.MIN };
        }
        return new LocalDateTime[]{ LocalDateTime.parse(val, ICS_DATETIME), LocalDateTime.MIN };
    }

    private static String unescape(String s) {
        return s.replace("\\n","\n").replace("\\,",",").replace("\\;",";").replace("\\\\","\\");
    }

    private CalendarEvent upsertFromIcs(ParsedVEvent v, String sourceUrl) {
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, v.uid)
                .orElseGet(CalendarEvent::new);
        ev.setSource(CalendarEvent.Source.ICLOUD);
        ev.setExternalId(v.uid);
        ev.setExternalCalendarId(sourceUrl);
        ev.setTitle(v.summary);
        ev.setDescription(v.description);
        ev.setLocation(v.location);
        ev.setAllDay(v.allDay);
        ev.setStartAt(v.dtstart);
        ev.setEndAt(v.dtend != null ? v.dtend
                : (v.allDay ? v.dtstart.withHour(23).withMinute(59) : v.dtstart.plusHours(1)));
        ev.setLastSyncedAt(LocalDateTime.now());
        return repository.save(ev);
    }

    private String buildVCalendar(String uid, CalendarEvent ev) {
        DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
        DateTimeFormatter d = DateTimeFormatter.ofPattern("yyyyMMdd");
        StringBuilder sb = new StringBuilder();
        sb.append("BEGIN:VCALENDAR\r\n")
                .append("VERSION:2.0\r\n")
                .append("PRODID:-//Pro Calendar//EN\r\n")
                .append("BEGIN:VEVENT\r\n")
                .append("UID:").append(uid).append("\r\n")
                .append("DTSTAMP:").append(LocalDateTime.now().format(f)).append("\r\n")
                .append("SUMMARY:").append(escapeIcs(ev.getTitle())).append("\r\n");
        if (ev.getDescription() != null) sb.append("DESCRIPTION:").append(escapeIcs(ev.getDescription())).append("\r\n");
        if (ev.getLocation() != null)    sb.append("LOCATION:").append(escapeIcs(ev.getLocation())).append("\r\n");
        if (ev.isAllDay()) {
            sb.append("DTSTART;VALUE=DATE:").append(ev.getStartAt().toLocalDate().format(d)).append("\r\n");
            sb.append("DTEND;VALUE=DATE:").append(ev.getEndAt().toLocalDate().plusDays(1).format(d)).append("\r\n");
        } else {
            sb.append("DTSTART:").append(ev.getStartAt().format(f)).append("\r\n");
            sb.append("DTEND:").append(ev.getEndAt().format(f)).append("\r\n");
        }
        sb.append("END:VEVENT\r\nEND:VCALENDAR\r\n");
        return sb.toString();
    }

    private static String escapeIcs(String s) {
        return s.replace("\\","\\\\").replace(";","\\;").replace(",","\\,").replace("\n","\\n");
    }

    // -----------------------------------------------------------------------
    // CalDAV helpers
    // -----------------------------------------------------------------------
    private String propfindSingle(String url, String basic, String depth, String body,
                                  String propNs, String propName) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Authorization", "Basic " + basic)
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", depth)
                .method("PROPFIND", HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() / 100 != 2)
            throw new RuntimeException("PROPFIND " + url + " -> HTTP " + res.statusCode());
        Document doc = parseXml(res.body());
        NodeList target = doc.getElementsByTagNameNS(propNs, propName);
        if (target.getLength() == 0) return null;
        NodeList hrefs = ((Element) target.item(0)).getElementsByTagNameNS("DAV:", "href");
        if (hrefs.getLength() == 0) return null;
        return hrefs.item(0).getTextContent().trim();
    }

    private static String absolutize(String base, String href) {
        if (href.startsWith("http://") || href.startsWith("https://")) return href;
        URI b = URI.create(base);
        return b.getScheme() + "://" + b.getAuthority() + (href.startsWith("/") ? href : "/" + href);
    }

    private static Document parseXml(String body) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        DocumentBuilder db = f.newDocumentBuilder();
        return db.parse(new InputSource(new StringReader(body)));
    }
}