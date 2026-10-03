package org.tpmnigeria.tpm.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.domain.androidDeviceId

/**
 * Pushes every `pending` sync-queue row via [SyncApiService] and flips it to `synced` on success.
 * Runs (a) once immediately after a submission if the device is online, (b) periodically, and
 * (c) whenever connectivity returns — see SyncScheduler for the WorkManager constraints/triggers.
 *
 * Processes [AppRepository.pendingSyncItemsOldestFirst] — creation order, not the Sync Queue
 * screen's newest-first display order — since a DRI Response/Final Verification submission can't
 * push to a row that doesn't exist server-side yet (see SupabaseSyncApiService.pushDriResponse's
 * remoteId == null early-return).
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
    private val repository: AppRepository,
    private val api: SyncApiService,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        try {
            runCatching { api.pullIssues() } // best-effort

            val items = repository.pendingSyncItemsOldestFirst()
            if (items.isEmpty()) {
                runCatching { api.afterSync() }
                reportStatus()
                return Result.success()
            }

            val blockedIssueIds = mutableSetOf<String>()
            var anyFailed = false
            for (item in items) {
                if (item.issueId in blockedIssueIds) continue
                
                val ok = try {
                    api.pushSubmission(item)
                } catch (e: Exception) {
                    android.util.Log.e("SyncWorker", "Unexpected error pushing ${item.issueId}", e)
                    false
                }

                if (ok) {
                    repository.markSynced(item.localId)
                } else {
                    anyFailed = true
                    blockedIssueIds += item.issueId
                    // Below AppRepository.MAX_SYNC_RETRIES this only increments the counter (the
                    // row stays Pending, WorkManager's own backoff keeps retrying it); past it,
                    // it flips to Failed and pendingSyncItemsOldestFirst() stops returning it — a
                    // chronically-broken submission no longer retries forever, and it becomes
                    // visible to the user instead of silently sitting as "Pending" indefinitely.
                    repository.recordFailedSyncAttempt(item.localId)
                }
            }
            runCatching { api.afterSync() }
            reportStatus()
            return if (anyFailed) Result.retry() else Result.success()
        } catch (e: Exception) {
            android.util.Log.e("SyncWorker", "Worker failed", e)
            return Result.failure()
        }
    }

    /** Tells the server what is still waiting on this phone (Offline Sync Health on the web). Never
     *  fails the run — offline, the report simply goes with the next one. */
    private suspend fun reportStatus() {
        runCatching { api.reportStatus(androidDeviceId(applicationContext), repository.unsyncedSyncItems()) }
            .onFailure { android.util.Log.w("SyncWorker", "Sync status report not sent: ${it.message}") }
    }
}
