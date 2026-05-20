package com.procalendar.sync.icloud;

import com.procalendar.event.CalendarEvent;
import com.procalendar.event.CalendarEventRepository;
import com.procalendar.sync.CalendarSyncProvider;
import com.procalendar.sync.SyncResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * iCloud Calendar sync via CalDAV.
 *
 * Wire-up plan (when ready):
 *  1. User generates an app-specific password at appleid.apple.com.
 *  2. The backend authenticates against https://caldav.icloud.com using Basic auth
 *     with appleId + app-specific password.
 *  3. PROPFIND discovers the principal and the user's calendar home set, then we
 *     REPORT calendar-query to pull VEVENTs.
 *  4. VEVENTs (RFC 5545 / iCalendar) are parsed and upserted by UID into
 *     {@link CalendarEvent} with source=ICLOUD.
 *  5. Local LOCAL events are pushed back as PUTs of .ics resources.
 */
@Service
public class ICloudCalDavSyncService implements CalendarSyncProvider {

    private static final Logger log = LoggerFactory.getLogger(ICloudCalDavSyncService.class);

    private final CalendarEventRepository repository;

    @Value("${procalendar.sync.icloud.enabled:false}")
    private boolean enabled;

    @Value("${procalendar.sync.icloud.apple-id:}")
    private String appleId;

    @Value("${procalendar.sync.icloud.app-password:}")
    private String appPassword;

    @Value("${procalendar.sync.icloud.calendar-url:}")
    private String calendarUrl;

    public ICloudCalDavSyncService(CalendarEventRepository repository) {
        this.repository = repository;
    }

    @Override
    public String name() { return "icloud"; }

    @Override
    public SyncResult pull() {
        if (!enabled) {
            log.info("iCloud sync is disabled (procalendar.sync.icloud.enabled=false).");
            return new SyncResult(name(), 0, 0, 0, 0, "disabled");
        }
        if (appleId.isBlank() || appPassword.isBlank()) {
            return new SyncResult(name(), 0, 0, 0, 0, "missing credentials");
        }
        // TODO: real CalDAV REPORT calendar-query, parse VEVENTs (ical4j is a good option),
        //       upsert via upsertFromIcs().
        log.info("[icloud] pull stub against {}", calendarUrl);
        return new SyncResult(name(), 0, 0, 0, 0, "stub pull");
    }

    @Override
    public SyncResult push() {
        if (!enabled) {
            return new SyncResult(name(), 0, 0, 0, 0, "disabled");
        }
        // TODO: serialize local events to .ics and PUT them under the user's calendar collection.
        log.info("[icloud] push stub against {}", calendarUrl);
        return new SyncResult(name(), 0, 0, 0, 0, "stub push");
    }

    @SuppressWarnings("unused")
    private CalendarEvent upsertFromIcs(String uid,
                                        String title,
                                        String description,
                                        LocalDateTime start,
                                        LocalDateTime end,
                                        boolean allDay) {
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.ICLOUD, uid)
                .orElseGet(CalendarEvent::new);
        ev.setSource(CalendarEvent.Source.ICLOUD);
        ev.setExternalId(uid);
        ev.setExternalCalendarId(calendarUrl);
        ev.setTitle(title);
        ev.setDescription(description);
        ev.setStartAt(start);
        ev.setEndAt(end);
        ev.setAllDay(allDay);
        ev.setLastSyncedAt(LocalDateTime.now());
        return repository.save(ev);
    }
}
