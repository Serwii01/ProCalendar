package com.procalendar.sync;

/** Common interface for any external calendar provider (Google, iCloud, future ones). */
public interface CalendarSyncProvider {

    /** Provider key, e.g. "google", "icloud". */
    String name();

    /** Pull events from the remote into the local DB. */
    SyncResult pull();

    /** Push local events to the remote. */
    SyncResult push();

    /** Convenience: pull then push so both sides converge. */
    default SyncResult fullSync() {
        SyncResult pull = pull();
        SyncResult push = push();
        return new SyncResult(
                name(),
                pull.getImported() + push.getImported(),
                pull.getUpdated() + push.getUpdated(),
                pull.getDeleted() + push.getDeleted(),
                pull.getSkipped() + push.getSkipped(),
                "full sync: " + pull.getMessage() + " | " + push.getMessage()
        );
    }
}
