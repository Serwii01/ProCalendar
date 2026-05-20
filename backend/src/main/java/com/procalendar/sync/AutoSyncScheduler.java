package com.procalendar.sync;

import com.procalendar.settings.SettingsService;
import com.procalendar.sync.google.GoogleCalendarSyncService;
import com.procalendar.sync.icloud.ICloudCalDavSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/** Runs a background sync every minute, but only executes the providers when
 *  enough time has passed since the last run (interval configurable from UI). */
@Component
public class AutoSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(AutoSyncScheduler.class);

    private final GoogleCalendarSyncService google;
    private final ICloudCalDavSyncService icloud;
    private final SettingsService settings;

    private volatile LocalDateTime lastRunAt;

    public AutoSyncScheduler(GoogleCalendarSyncService google,
                             ICloudCalDavSyncService icloud,
                             SettingsService settings) {
        this.google   = google;
        this.icloud   = icloud;
        this.settings = settings;
    }

    @Scheduled(fixedDelay = 60_000)   // check every minute
    public void tick() {
        if (!settings.getBool(SettingsService.AUTO_SYNC_ENABLED, true)) return;

        int minutes = settings.getInt(SettingsService.AUTO_SYNC_MINUTES, 5);
        if (lastRunAt != null && ChronoUnit.MINUTES.between(lastRunAt, LocalDateTime.now()) < minutes) return;

        lastRunAt = LocalDateTime.now();
        try {
            SyncResult ic = icloud.fullSync();
            log.info("[autosync] icloud: {}", ic.getMessage());
        } catch (Exception e) {
            log.warn("[autosync] icloud failed: {}", e.getMessage());
        }
        try {
            SyncResult gg = google.fullSync();
            log.info("[autosync] google: {}", gg.getMessage());
        } catch (Exception e) {
            log.warn("[autosync] google failed: {}", e.getMessage());
        }
    }

    public LocalDateTime getLastRunAt() { return lastRunAt; }
}
