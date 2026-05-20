package com.procalendar.event;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "calendar_event", indexes = {
        @Index(name = "idx_event_start", columnList = "startAt"),
        @Index(name = "idx_event_source_external", columnList = "source,externalId")
})
public class CalendarEvent {

    public enum Source { LOCAL, GOOGLE, ICLOUD }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 2000)
    private String description;

    @Column(length = 200)
    private String location;

    @Column(nullable = false)
    private LocalDateTime startAt;

    @Column(nullable = false)
    private LocalDateTime endAt;

    /** iCloud-style "all day" flag. When true, startAt/endAt represent days, time is ignored. */
    @Column(nullable = false)
    private boolean allDay = false;

    /** Hex color (#RRGGBB) for chip rendering, similar to iCloud calendar colors. */
    @Column(length = 9)
    private String color;

    /** Where this event originated. LOCAL by default. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Source source = Source.LOCAL;

    /** Remote identifier (Google event id or iCloud UID) used to reconcile during sync. */
    @Column(length = 255)
    private String externalId;

    /** Calendar id on the remote side (Google calendar id or iCloud collection href). */
    @Column(length = 255)
    private String externalCalendarId;

    /** Full URL of the .ics resource on iCloud (needed for DELETE/PUT). */
    @Column(length = 500)
    private String externalResourceUrl;

    /** Human-readable name of the source calendar (e.g. "Trabajo", "Estudios"). */
    @Column(length = 120)
    private String calendarName;

    private LocalDateTime lastSyncedAt;

    /** True if the event has local changes pending push to its remote calendar. */
    @Column(nullable = false)
    private boolean dirty = false;

    @Version
    private Long version;

    public CalendarEvent() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }

    public LocalDateTime getStartAt() { return startAt; }
    public void setStartAt(LocalDateTime startAt) { this.startAt = startAt; }

    public LocalDateTime getEndAt() { return endAt; }
    public void setEndAt(LocalDateTime endAt) { this.endAt = endAt; }

    public boolean isAllDay() { return allDay; }
    public void setAllDay(boolean allDay) { this.allDay = allDay; }

    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }

    public Source getSource() { return source; }
    public void setSource(Source source) { this.source = source; }

    public String getExternalId() { return externalId; }
    public void setExternalId(String externalId) { this.externalId = externalId; }

    public String getExternalCalendarId() { return externalCalendarId; }
    public void setExternalCalendarId(String externalCalendarId) { this.externalCalendarId = externalCalendarId; }

    public String getExternalResourceUrl() { return externalResourceUrl; }
    public void setExternalResourceUrl(String externalResourceUrl) { this.externalResourceUrl = externalResourceUrl; }

    public String getCalendarName() { return calendarName; }
    public void setCalendarName(String calendarName) { this.calendarName = calendarName; }

    public LocalDateTime getLastSyncedAt() { return lastSyncedAt; }
    public void setLastSyncedAt(LocalDateTime lastSyncedAt) { this.lastSyncedAt = lastSyncedAt; }

    public boolean isDirty() { return dirty; }
    public void setDirty(boolean dirty) { this.dirty = dirty; }

    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }
}
