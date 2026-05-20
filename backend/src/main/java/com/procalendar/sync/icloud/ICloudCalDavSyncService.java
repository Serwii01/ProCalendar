package com.procalendar.sync.icloud;

import com.procalendar.event.CalendarEvent;
import com.procalendar.event.CalendarEventRepository;
import com.procalendar.settings.SettingsService;
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

    @Value("${procalendar.sync.icloud.enabled:false}") private boolean enabledProp;
    @Value("${procalendar.sync.icloud.apple-id:}")     private String appleIdProp;
    @Value("${procalendar.sync.icloud.app-password:}") private String appPasswordProp;
    @Value("${procalendar.sync.icloud.calendar-url:}") private String calendarUrlProp;

    private final SettingsService settings;

    /** Calendar metadata: url → (name, color). */
    public record CalendarInfo(String name, String url, String color) {}
    private volatile List<CalendarInfo> discoveredCalendars;

    public ICloudCalDavSyncService(CalendarEventRepository repository, SettingsService settings) {
        this.repository = repository;
        this.settings   = settings;
    }

    // Effective values (DB overrides properties)
    private boolean enabled()      { return settings.getBool(SettingsService.ICLOUD_ENABLED, enabledProp); }
    private String  appleId()      { return settings.get(SettingsService.ICLOUD_APPLE_ID, appleIdProp); }
    private String  appPassword()  { return settings.get(SettingsService.ICLOUD_APP_PASSWORD, appPasswordProp); }
    private String  calendarUrl()  { return settings.get(SettingsService.ICLOUD_CALENDAR_URL, calendarUrlProp); }

    @Override public String name() { return "icloud"; }

    // -----------------------------------------------------------------------
    // PULL
    // -----------------------------------------------------------------------
    @Override
    public SyncResult pull() {
        if (!enabled()) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");
        if (appleId().isBlank() || appPassword().isBlank())
            return new SyncResult(name(), 0, 0, 0, 0, "faltan apple-id / app-password");

        List<CalendarInfo> cals = resolveAllCalendars();
        if (cals.isEmpty()) return new SyncResult(name(), 0, 0, 0, 0, "no se encontraron calendarios");

        String basic = buildBasic();
        int imported = 0, updated = 0, skipped = 0;

        for (CalendarInfo cal : cals) {
            log.info("[icloud] pulling from: {} ({})", cal.name(), cal.url());
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(cal.url()))
                        .header("Authorization", "Basic " + basic)
                        .header("Content-Type", "application/xml; charset=utf-8")
                        .header("Depth", "1")
                        .method("REPORT", HttpRequest.BodyPublishers.ofString(CALENDAR_QUERY_BODY, StandardCharsets.UTF_8))
                        .build();

                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (res.statusCode() / 100 != 2) {
                    log.warn("[icloud] HTTP {} for {}", res.statusCode(), cal.url());
                    continue;
                }

                // Iterate per <D:response>: emparejamos href + calendar-data
                Document doc = parseXml(res.body());
                NodeList responses = doc.getElementsByTagNameNS("DAV:", "response");
                for (int i = 0; i < responses.getLength(); i++) {
                    Element r = (Element) responses.item(i);
                    NodeList hrefs = r.getElementsByTagNameNS("DAV:", "href");
                    NodeList datas = r.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar-data");
                    if (datas.getLength() == 0) continue;

                    String resourceHref = hrefs.getLength() > 0 ? hrefs.item(0).getTextContent().trim() : null;
                    String resourceUrl  = resourceHref == null ? null : absolutize(cal.url(), resourceHref);
                    String ics = datas.item(0).getTextContent();

                    ParsedVEvent v = parseVEvent(ics);
                    if (v == null || v.uid == null || v.summary == null || v.dtstart == null) { skipped++; continue; }
                    boolean isNew = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, v.uid).isEmpty();
                    upsertFromIcs(v, cal, resourceUrl);
                    if (isNew) imported++; else updated++;
                }
            } catch (Exception e) {
                log.error("[icloud] pull error for {}: {}", cal.url(), e.getMessage());
            }
        }
        return new SyncResult(name(), imported, updated, 0, skipped, "pull ok (" + cals.size() + " calendarios)");
    }

    // -----------------------------------------------------------------------
    // PUSH — sincronización bidireccional:
    //  1. Eventos LOCAL nuevos con calendario asignado → crear en iCloud (PUT If-None-Match:*)
    //  2. Eventos ICLOUD con dirty=true → actualizar en iCloud (PUT sobrescribe)
    // -----------------------------------------------------------------------
    @Override
    public SyncResult push() {
        if (!enabled()) return new SyncResult(name(), 0, 0, 0, 0, "deshabilitado");

        String fallbackUrl = calendarUrl().isBlank() ? getFirstDiscoveredUrl() : calendarUrl();
        int created = 0, updated = 0, errors = 0;
        String basic = buildBasic();

        for (CalendarEvent ev : repository.findAll()) {

            // CASE A: nuevo evento local → crear remoto
            if (ev.getSource() == CalendarEvent.Source.LOCAL && ev.getExternalId() == null) {
                String targetUrl = ev.getExternalCalendarId() != null && !ev.getExternalCalendarId().isBlank()
                        ? ev.getExternalCalendarId() : fallbackUrl;
                if (targetUrl == null || targetUrl.isBlank()) continue; // no calendar selected, skip (local-only)

                String uid = "procal-" + ev.getId() + "@local";
                String ics = buildVCalendar(uid, ev);
                String href = targetUrl + (targetUrl.endsWith("/") ? "" : "/") + uid + ".ics";
                if (sendPut(href, ics, basic, true)) {
                    ev.setSource(CalendarEvent.Source.ICLOUD);
                    ev.setExternalId(uid);
                    ev.setExternalCalendarId(targetUrl);
                    ev.setExternalResourceUrl(href);
                    if (ev.getCalendarName() == null) nameFor(targetUrl).ifPresent(ev::setCalendarName);
                    ev.setLastSyncedAt(LocalDateTime.now());
                    ev.setDirty(false);
                    repository.save(ev);
                    created++;
                } else errors++;
                continue;
            }

            // CASE B: evento iCloud modificado localmente → actualizar remoto
            if (ev.getSource() == CalendarEvent.Source.ICLOUD && ev.isDirty()
                    && ev.getExternalResourceUrl() != null) {
                String ics = buildVCalendar(ev.getExternalId(), ev);
                if (sendPut(ev.getExternalResourceUrl(), ics, basic, false)) {
                    ev.setLastSyncedAt(LocalDateTime.now());
                    ev.setDirty(false);
                    repository.save(ev);
                    updated++;
                } else errors++;
            }
        }
        return new SyncResult(name(), 0, created + updated, 0, errors,
                String.format("push: %d creados, %d actualizados", created, updated));
    }

    /** PUT helper: ifNoneMatch=true para creaciones, false para sobrescribir. */
    private boolean sendPut(String url, String ics, String basic, boolean ifNoneMatch) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Basic " + basic)
                    .header("Content-Type", "text/calendar; charset=utf-8")
                    .PUT(HttpRequest.BodyPublishers.ofString(ics, StandardCharsets.UTF_8));
            if (ifNoneMatch) b.header("If-None-Match", "*");
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() / 100 == 2) return true;
            log.warn("[icloud] PUT {} -> HTTP {} body={}", url, r.statusCode(),
                    r.body() == null ? "" : r.body().substring(0, Math.min(200, r.body().length())));
            return false;
        } catch (Exception e) {
            log.warn("[icloud] PUT failed for {}: {}", url, e.getMessage());
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // DELETE remoto — borra el .ics en iCloud para un evento dado
    // -----------------------------------------------------------------------
    public boolean deleteRemote(CalendarEvent ev) {
        if (!enabled()) return false;
        if (ev.getExternalResourceUrl() == null || ev.getExternalResourceUrl().isBlank()) {
            log.warn("[icloud] cannot delete remote: event {} has no externalResourceUrl", ev.getId());
            return false;
        }
        try {
            HttpRequest del = HttpRequest.newBuilder()
                    .uri(URI.create(ev.getExternalResourceUrl()))
                    .header("Authorization", "Basic " + buildBasic())
                    .DELETE()
                    .build();
            HttpResponse<String> r = http.send(del, HttpResponse.BodyHandlers.ofString());
            log.info("[icloud] DELETE {} -> HTTP {}", ev.getExternalResourceUrl(), r.statusCode());
            return r.statusCode() / 100 == 2 || r.statusCode() == 404; // 404 = ya no existía
        } catch (Exception e) {
            log.error("[icloud] delete remote failed: {}", e.getMessage());
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Discovery público
    // -----------------------------------------------------------------------
    public List<CalendarInfo> discoverCalendarsWithMeta() throws Exception {
        String basic = buildBasic();

        String principalUrl = resolvePrincipalUrl(basic);
        log.info("[icloud] principal URL: {}", principalUrl);

        String homeSet = propfindHrefOrText(principalUrl, basic, "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
                  <D:prop><C:calendar-home-set/></D:prop>
                </D:propfind>
                """, "urn:ietf:params:xml:ns:caldav", "calendar-home-set");
        if (homeSet == null) throw new RuntimeException("calendar-home-set no encontrado en " + principalUrl);
        String homeUrl = absolutize(principalUrl, homeSet);
        log.info("[icloud] calendar home: {}", homeUrl);

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(homeUrl))
                .header("Authorization", "Basic " + basic)
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "1")
                .method("PROPFIND", HttpRequest.BodyPublishers.ofString("""
                        <?xml version="1.0" encoding="utf-8" ?>
                        <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"
                                    xmlns:ICAL="http://apple.com/ns/ical/">
                          <D:prop>
                            <D:resourcetype/>
                            <D:displayname/>
                            <C:supported-calendar-component-set/>
                            <ICAL:calendar-color/>
                          </D:prop>
                        </D:propfind>
                        """, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() / 100 != 2) throw new RuntimeException("HTTP " + res.statusCode() + " listing home " + homeUrl);

        Document doc = parseXml(res.body());
        NodeList responses = doc.getElementsByTagNameNS("DAV:", "response");
        List<CalendarInfo> result = new ArrayList<>();

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

            NodeList hrefs  = r.getElementsByTagNameNS("DAV:", "href");
            NodeList names  = r.getElementsByTagNameNS("DAV:", "displayname");
            NodeList colors = r.getElementsByTagNameNS("http://apple.com/ns/ical/", "calendar-color");
            if (hrefs.getLength() == 0) continue;

            String url   = absolutize(homeUrl, hrefs.item(0).getTextContent().trim());
            String name  = names.getLength()  > 0 ? names.item(0).getTextContent().trim() : url;
            String color = colors.getLength() > 0 ? normalizeColor(colors.item(0).getTextContent().trim()) : null;
            result.add(new CalendarInfo(name, url, color));
            log.info("[icloud] calendario encontrado: '{}' color={} -> {}", name, color, url);
        }

        this.discoveredCalendars = result;
        return result;
    }

    /** Returns the iCloud calendar name for a given calendar URL, if discovery has been run. */
    public Optional<String> nameFor(String url) {
        if (discoveredCalendars == null) return Optional.empty();
        return discoveredCalendars.stream()
                .filter(c -> Objects.equals(c.url(), url))
                .map(CalendarInfo::name)
                .findFirst();
    }

    private static String normalizeColor(String s) {
        if (s == null) return null;
        // Apple sometimes returns #RRGGBBAA — strip alpha
        if (s.length() == 9 && s.startsWith("#")) return s.substring(0, 7);
        return s;
    }

    // -----------------------------------------------------------------------
    // Principal resolution
    // -----------------------------------------------------------------------
    private String resolvePrincipalUrl(String basic) throws Exception {
        try {
            HttpRequest wk = HttpRequest.newBuilder()
                    .uri(URI.create("https://caldav.icloud.com/.well-known/caldav"))
                    .header("Authorization", "Basic " + basic)
                    .header("Depth", "0")
                    .GET()
                    .build();
            HttpResponse<String> wkRes = http.send(wk, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            String finalUrl = wkRes.uri().toString();
            if (!finalUrl.equals("https://caldav.icloud.com/.well-known/caldav")
                    && !finalUrl.equals("https://caldav.icloud.com/")) {
                return finalUrl;
            }
        } catch (Exception ignored) {}

        String principal = propfindHrefOrText("https://caldav.icloud.com/", basic, "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:">
                  <D:prop><D:current-user-principal/></D:prop>
                </D:propfind>
                """, "DAV:", "current-user-principal");
        if (principal != null) return absolutize("https://caldav.icloud.com/", principal);

        String principalUrl2 = propfindHrefOrText("https://caldav.icloud.com/", basic, "0",
                """
                <?xml version="1.0" encoding="utf-8" ?>
                <D:propfind xmlns:D="DAV:">
                  <D:prop><D:principal-URL/></D:prop>
                </D:propfind>
                """, "DAV:", "principal-URL");
        if (principalUrl2 != null) return absolutize("https://caldav.icloud.com/", principalUrl2);

        throw new RuntimeException("No se pudo obtener el principal de iCloud. " +
                "Verifica apple-id (" + appleId() + ") y app-password.");
    }

    private List<CalendarInfo> resolveAllCalendars() {
        if (!calendarUrl().isBlank()) return List.of(new CalendarInfo("iCloud", calendarUrl(), null));
        if (discoveredCalendars != null && !discoveredCalendars.isEmpty()) return discoveredCalendars;
        try { return discoverCalendarsWithMeta(); }
        catch (Exception e) {
            log.error("[icloud] auto-discovery failed: {}", e.getMessage());
            return List.of();
        }
    }

    private String getFirstDiscoveredUrl() {
        List<CalendarInfo> cals = resolveAllCalendars();
        return cals.isEmpty() ? null : cals.get(0).url();
    }

    private String buildBasic() {
        return Base64.getEncoder().encodeToString(
                (appleId() + ":" + appPassword()).getBytes(StandardCharsets.UTF_8));
    }

    private String propfindHrefOrText(String url, String basic, String depth, String body,
                                      String propNs, String propName) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Authorization", "Basic " + basic)
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", depth)
                .method("PROPFIND", HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() / 100 != 2) throw new RuntimeException("PROPFIND " + url + " -> HTTP " + res.statusCode());

        Document doc = parseXml(res.body());
        NodeList target = doc.getElementsByTagNameNS(propNs, propName);
        if (target.getLength() == 0) return null;

        Element elem = (Element) target.item(0);
        NodeList hrefs = elem.getElementsByTagNameNS("DAV:", "href");
        if (hrefs.getLength() > 0) {
            String val = hrefs.item(0).getTextContent().trim();
            if (!val.isBlank()) return val;
        }
        String text = elem.getTextContent().trim();
        return text.isBlank() ? null : text;
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
            String pname = head.contains(";") ? head.substring(0, head.indexOf(';')) : head;
            switch (pname) {
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

    private CalendarEvent upsertFromIcs(ParsedVEvent v, CalendarInfo cal, String resourceUrl) {
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, v.uid)
                .orElseGet(CalendarEvent::new);
        ev.setSource(CalendarEvent.Source.ICLOUD);
        ev.setExternalId(v.uid);
        ev.setExternalCalendarId(cal.url());
        ev.setExternalResourceUrl(resourceUrl);
        ev.setCalendarName(cal.name());
        if (cal.color() != null && (ev.getColor() == null || isCalendarColor(ev.getColor()))) {
            ev.setColor(cal.color());
        }
        ev.setTitle(v.summary);
        ev.setDescription(v.description);
        ev.setLocation(v.location);
        ev.setAllDay(v.allDay);
        ev.setStartAt(v.dtstart);
        ev.setEndAt(v.dtend != null ? v.dtend
                : (v.allDay ? v.dtstart.withHour(23).withMinute(59) : v.dtstart.plusHours(1)));
        ev.setLastSyncedAt(LocalDateTime.now());
        ev.setDirty(false);  // pull authoritative
        return repository.save(ev);
    }

    /** Heurística: si el color empieza por #, lo consideramos un color de calendario y lo refrescamos. */
    private static boolean isCalendarColor(String c) {
        return c != null && c.startsWith("#");
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
