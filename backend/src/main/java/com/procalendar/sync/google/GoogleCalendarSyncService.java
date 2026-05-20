package com.procalendar.sync.google;

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
 * Google Calendar sync scaffolding.
 *
 * Wire-up plan (when ready):
 *  1. User logs in via Spring Security OAuth2 (already on the classpath).
 *  2. Backend obtains an access token with scope https://www.googleapis.com/auth/calendar.
 *  3. Calls https://www.googleapis.com/calendar/v3/calendars/{calId}/events with the
 *     incremental syncToken stored per user.
 *  4. Maps each Google event -> {@link CalendarEvent} and upserts by (source, externalId).
 */
@Service
public class GoogleCalendarSyncService implements CalendarSyncProvider {

    private static final Logger log = LoggerFactory.getLogger(GoogleCalendarSyncService.class);

    private final CalendarEventRepository repository;

    @Value("${procalendar.sync.google.enabled:false}")
    private boolean enabled;

    @Value("${procalendar.sync.google.calendar-id:primary}")
    private String calendarId;

    public GoogleCalendarSyncService(CalendarEventRepository repository) {
        this.repository = repository;
    }

    @Override
    public String name() { return "google"; }

    @Override
    public SyncResult pull() {
        if (!enabled) {
            log.info("Google sync is disabled (procalendar.sync.google.enabled=false).");
            return new SyncResult(name(), 0, 0, 0, 0, "disabled");
        }
        // TODO: implement real Google Calendar API call using OAuth2 token.
        log.info("[google] pull stub for calendar={}", calendarId);
        return new SyncResult(name(), 0, 0, 0, 0, "stub pull");
    }

    @Override
    public SyncResult push() {
        if (!enabled) {
            return new SyncResult(name(), 0, 0, 0, 0, "disabled");
        }
        // TODO: send local LOCAL/UNSYNCED events to Google, then mark them as GOOGLE with externalId.
        log.info("[google] push stub for calendar={}", calendarId);
        return new SyncResult(name(), 0, 0, 0, 0, "stub push");
    }

    /** Upsert helper used by the real implementation once it exists. */
    @SuppressWarnings("unused")
    private CalendarEvent upsertFromGoogle(String externalId,
                                           String title,
                                           String description,
                                           LocalDateTime start,
                                           LocalDateTime end,
                                           boolean allDay) {
        CalendarEvent ev = repository.findBySourceAndExternalId(CalendarEvent.Source.GOOGLE, externalId)
                .orElseGet(CalendarEvent::new);
        ev.setSource(CalendarEvent.Source.GOOGLE);
        ev.setExternalId(externalId);
        ev.setExternalCalendarId(calendarId);
        ev.setTitle(title);
        ev.setDescription(description);
        ev.setStartAt(start);
        ev.setEndAt(end);
        ev.setAllDay(allDay);
        ev.setLastSyncedAt(LocalDateTime.now());
        return repository.save(ev);
    }
}
