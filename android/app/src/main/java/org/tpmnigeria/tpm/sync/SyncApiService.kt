package org.tpmnigeria.tpm.sync

import kotlinx.coroutines.delay
import org.tpmnigeria.tpm.domain.model.SyncQueueItem

/**
 * The client-side sync contract. [SupabaseSyncApiService] is the real, in-use implementation
 * (TPM Monitoring Platform Supabase project — see DECISIONS.md #7 in the web project for the
 * workflow it implements). [StubSyncApiService] is kept around as a network-free stand-in for
 * local UI development/testing of the wizards and Sync Queue screen without touching the real
 * backend — swap it in manually (SyncWorkerFactory) if you need that.
 */
interface SyncApiService {
    /** Returns true on a successful push; false (not an exception) for an ordinary/retryable failure. */
    suspend fun pushSubmission(item: SyncQueueItem): Boolean

    /** Refreshes the local read cache from the backend (no-op by default) — see
     *  SupabaseSyncApiService.pullIssues, called from SyncWorker before pushing each run. */
    suspend fun pullIssues() {}

    /** Refreshes the full detail (history, GPS, photos) for a single issue. */
    suspend fun pullIssueDetail(remoteId: String) {}
}

/** Always-succeeds, no-network stand-in — see the interface kdoc above for when to use this
 *  instead of [SupabaseSyncApiService]. */
class StubSyncApiService : SyncApiService {
    override suspend fun pushSubmission(item: SyncQueueItem): Boolean {
        delay(400)
        return true
    }

    override suspend fun pullIssueDetail(remoteId: String) {
        delay(400)
    }
}
