package com.procalendar.sync;

import java.time.LocalDateTime;

/** Lightweight DTO returned by sync endpoints so the UI can show a summary. */
public class SyncResult {
    private final String provider;
    private final int imported;
    private final int updated;
    private final int deleted;
    private final int skipped;
    private final LocalDateTime finishedAt;
    private final String message;

    public SyncResult(String provider, int imported, int updated, int deleted, int skipped, String message) {
        this.provider = provider;
        this.imported = imported;
        this.updated = updated;
        this.deleted = deleted;
        this.skipped = skipped;
        this.finishedAt = LocalDateTime.now();
        this.message = message;
    }

    public String getProvider() { return provider; }
    public int getImported() { return imported; }
    public int getUpdated() { return updated; }
    public int getDeleted() { return deleted; }
    public int getSkipped() { return skipped; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public String getMessage() { return message; }
}
