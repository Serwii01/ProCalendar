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
import org.w3c.dom.Node;
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
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * iCloud Calendar sync via CalDAV (RFC 4791).
 *
 * Quick-start for the user:
 *  1. Generate an app-specific password at https://appleid.apple.com.
 *  2. Set in application.properties:
 *       procalendar.sync.icloud.enabled=true
 *       procalendar.sync.icloud.apple-id=tu@icloud.com
 *       procalendar.sync.icloud.app-password=xxxx-xxxx-xxxx-xxxx
 *       procalendar.sync.icloud.calendar-url=https://pXX-caldav.icloud.com/<userId>/calendars/home/
 *     The exact calendar URL depends on your iCloud user; you can discover it
 *     via PROPFIND on caldav.icloud.com. For now, paste your Calendar URL here.
 *
 * Implementation:
 *  - POST with REPORT method against the calendar collection URL.
 *  - Request body asks for VEVENT items via calendar-query.
 *  - The response is a multistatus XML; we extract each <C:calendar-data>
 *    block (an .ics blob) and parse the VEVENT lines.
 */
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

    /** Cached after first auto-discovery so we don't repeat PROPFINDs every sync. */
    private volatile String discoveredCalendarUrl;

    public ICloudCalDavSyncService(CalendarEventRepository repository) {
        this.repository = repository;
    }

    @Override public String name() { return "icloud"; }

    @Override
    public SyncResult pull() {
        if (!enabled) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado (procalendar.sync.icloud.enabled=false)");
        if (appleId.isBlank() || appPassword.isBlank())
            return new SyncResult(name(), 0, 0, 0, 0, "faltan apple-id / app-password");

        // Auto-discover the calendar URL if not configured
        String url = !calendarUrl.isBlank() ? calendarUrl : discoveredCalendarUrl;
        if (url == null || url.isBlank()) {
            try {
                List<String> found = discoverCalendars();
                if (found.isEmpty()) return new SyncResult(name(), 0, 0, 0, 0, "no se encontró ningún calendario en iCloud");
                discoveredCalendarUrl = found.get(0);
                url = discoveredCalendarUrl;
                log.info("[icloud] auto-discovered calendar URL: {}", url);
            } catch (Exception e) {
                log.error("[icloud] discovery error", e);
                return new SyncResult(name(), 0, 0, 0, 0, "no se pudo descubrir la URL: " + e.getMessage());
            }
        }

        int imported = 0, updated = 0, skipped = 0;
        try {
            String basic = Base64.getEncoder().encodeToString((appleId + ":" + appPassword).getBytes(StandardCharsets.UTF_8));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Basic " + basic)
                    .header("Content-Type", "application/xml; charset=utf-8")
                    .header("Depth", "1")
                    .method("REPORT", HttpRequest.BodyPublishers.ofString(CALENDAR_QUERY_BODY, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() / 100 != 2) {
                return new SyncResult(name(), 0, 0, 0, 0, "HTTP " + res.statusCode());
            }

            // Parse multistatus XML and extract every <calendar-data> blob.
            Document doc = parseXml(res.body());
            NodeList datas = doc.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar-data");
            for (int i = 0; i < datas.getLength(); i++) {
                String ics = datas.item(i).getTextContent();
                ParsedVEvent v = parseVEvent(ics);
                if (v == null || v.uid == null || v.summary == null || v.dtstart == null) { skipped++; continue; }
                boolean isNew = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, v.uid).isEmpty();
                upsertFromIcs(v);
                if (isNew) imported++; else updated++;
            }
            return new SyncResult(name(), imported, updated, 0, skipped, "pull ok");
        } catch (Exception e) {
            log.error("[icloud] pull error", e);
            return new SyncResult(name(), imported, updated, 0, skipped, "error: " + e.getMessage());
        }
    }

    @Override
    public SyncResult push() {
        if (!enabled) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");
        if (calendarUrl.isBlank()) return new SyncResult(name(), 0, 0, 0, 0, "falta calendar-url");

        int pushed = 0, errors = 0;
        String basic = Base64.getEncoder().encodeToString((appleId + ":" + appPassword).getBytes(StandardCharsets.UTF_8));

        for (CalendarEvent ev : repository.findAll()) {
            if (ev.getSource() != CalendarEvent.Source.LOCAL || ev.getExternalId() != null) continue;
            String uid = "procal-" + ev.getId() + "@local";
            String ics = buildVCalendar(uid, ev);
            String href = calendarUrl + (calendarUrl.endsWith("/") ? "" : "/") + uid + ".ics";
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
                    ev.setExternalCalendarId(calendarUrl);
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
    // VEVENT parsing
    // -----------------------------------------------------------------------
    private static final DateTimeFormatter ICS_DATETIME = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
    private static final DateTimeFormatter ICS_DATE     = DateTimeFormatter.ofPattern("yyyyMMdd");

    private static class ParsedVEvent {
        String uid, summary, description, location;
        LocalDateTime dtstart, dtend;
        boolean allDay;
    }

    /** Minimal but robust VEVENT parser. Handles line unfolding and DATE vs DATE-TIME values. */
    static ParsedVEvent parseVEvent(String ics) {
        // RFC 5545 line unfolding: a line starting with space/tab continues the previous one.
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
        // head examples:
        //   DTSTART;VALUE=DATE         -> all-day, val = yyyymmdd
        //   DTSTART;TZID=Europe/Madrid -> floating local, val = yyyymmddThhmmss
        //   DTSTART                    -> UTC (suffix Z), val = yyyymmddThhmmssZ
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

    private CalendarEvent upsertFromIcs(ParsedVEvent v) {
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, v.uid)
                .orElseGet(CalendarEvent::new);
        ev.setSource(CalendarEvent.Source.ICLOUD);
        ev.setExternalId(v.uid);
        ev.setExternalCalendarId(calendarUrl);
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
    // CalDAV auto-discovery (RFC 5397 + RFC 4791)
    // -----------------------------------------------------------------------
    /**
     * Discovers the user's calendar collections by doing the standard CalDAV
     * PROPFIND chain: well-known root -> current-user-principal ->
     * calendar-home-set -> child collections (PROPFIND Depth:1).
     *
     * Returns a list of full HTTP URLs to each calendar collection.
     */
    public List<String> discoverCalendars() throws Exception {
        String basic = Base64.getEncoder().encodeToString(
                (appleId + ":" + appPassword).getBytes(StandardCharsets.UTF_8));

        // 1) PROPFIND on root to get the principal URL
        String principal = propfindSingle(
                "https://caldav.icloud.com/",
                basic,
                "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:">
                  <D:prop><D:current-user-principal/></D:prop>
                </D:propfind>
                """,
                "DAV:", "current-user-principal");
        if (principal == null) throw new RuntimeException("principal no encontrado");
        String principalUrl = absolutize("https://caldav.icloud.com/", principal);

        // 2) PROPFIND on principal to get the calendar-home-set
        String homeSet = propfindSingle(
                principalUrl,
                basic,
                "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                  <D:prop><C:calendar-home-set/></D:prop>
                </D:propfind>
                """,
                "urn:ietf:params:xml:ns:caldav", "calendar-home-set");
        if (homeSet == null) throw new RuntimeException("calendar-home-set no encontrado");
        String homeUrl = absolutize(principalUrl, homeSet);

        // 3) PROPFIND Depth:1 on the home to list child collections
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
        if (res.statusCode() / 100 != 2) throw new RuntimeException("HTTP " + res.statusCode() + " listando calendarios");

        Document doc = parseXml(res.body());
        NodeList responses = doc.getElementsByTagNameNS("DAV:", "response");
        List<String> calendars = new ArrayList<>();
        for (int i = 0; i < responses.getLength(); i++) {
            Element r = (Element) responses.item(i);
            // Need both a <calendar/> in resourcetype AND VEVENT in supported-calendar-component-set
            NodeList rtype = r.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar");
            if (rtype.getLength() == 0) continue;

            NodeList comps = r.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "comp");
            boolean hasVevent = false;
            for (int j = 0; j < comps.getLength(); j++) {
                String name = ((Element) comps.item(j)).getAttribute("name");
                if ("VEVENT".equalsIgnoreCase(name)) { hasVevent = true; break; }
            }
            if (!hasVevent) continue;

            NodeList hrefs = r.getElementsByTagNameNS("DAV:", "href");
            if (hrefs.getLength() == 0) continue;
            String href = hrefs.item(0).getTextContent().trim();
            calendars.add(absolutize(homeUrl, href));
        }
        return calendars;
    }

    /** Runs a PROPFIND Depth:0 and extracts the first <href> inside a specific property. */
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
        if (res.statusCode() / 100 != 2) {
            throw new RuntimeException("PROPFIND " + url + " -> HTTP " + res.statusCode());
        }
        Document doc = parseXml(res.body());
        NodeList target = doc.getElementsByTagNameNS(propNs, propName);
        if (target.getLength() == 0) return null;
        NodeList hrefs = ((Element) target.item(0)).getElementsByTagNameNS("DAV:", "href");
        if (hrefs.getLength() == 0) return null;
        return hrefs.item(0).getTextContent().trim();
    }

    /** Resolves a possibly relative href against a base URL. */
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
