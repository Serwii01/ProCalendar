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
 *  enough time has passed since the last run (interval configurable from UI).
 *  Silences repeated failures: solo loguea WARN cuando cambia el estado. */
@Component
public class AutoSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(AutoSyncScheduler.class);

    private final GoogleCalendarSyncService google;
    private final ICloudCalDavSyncService icloud;
    private final SettingsService settings;

    private volatile LocalDateTime lastRunAt;
    private volatile String lastIcloudMessage = "";
    private volatile String lastGoogleMessage = "";

    public AutoSyncScheduler(GoogleCalendarSyncService google,
                             ICloudCalDavSyncService icloud,
                             SettingsService settings) {
        this.google   = google;
        this.icloud   = icloud;
        this.settings = settings;
    }

    @Scheduled(fixedDelay = 60_000)
    public void tick() {
        if (!settings.getBool(SettingsService.AUTO_SYNC_ENABLED, true)) return;

        int minutes = settings.getInt(SettingsService.AUTO_SYNC_MINUTES, 5);
        if (lastRunAt != null && ChronoUnit.MINUTES.between(lastRunAt, LocalDateTime.now()) < minutes) return;

        lastRunAt = LocalDateTime.now();

        // iCloud
        try {
            SyncResult ic = icloud.fullSync();
            String msg = ic.getMessage() == null ? "" : ic.getMessage();
            if (!msg.equals(lastIcloudMessage)) {
                log.info("[autosync] icloud: {}", msg);
                lastIcloudMessage = msg;
            }
        } catch (Exception e) {
            String msg = String.valueOf(e.getMessage());
            if (!msg.equals(lastIcloudMessage)) {
                log.warn("[autosync] icloud failed: {}", msg);
                lastIcloudMessage = msg;
            }
        }

        // Google
        try {
            SyncResult gg = google.fullSync();
            String msg = gg.getMessage() == null ? "" : gg.getMessage();
            if (!msg.equals(lastGoogleMessage)) {
                log.info("[autosync] google: {}", msg);
                lastGoogleMessage = msg;
            }
        } catch (Exception e) {
            String msg = String.valueOf(e.getMessage());
            if (!msg.equals(lastGoogleMessage)) {
                log.warn("[autosync] google failed: {}", msg);
                lastGoogleMessage = msg;
            }
        }
    }

    public LocalDateTime getLastRunAt() { return lastRunAt; }
}
