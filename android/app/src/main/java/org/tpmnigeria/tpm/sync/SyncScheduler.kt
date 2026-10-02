package org.tpmnigeria.tpm.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * WorkManager entry points for the sync pipeline: a periodic run as a safety net, plus an
 * immediate one-shot request fired (a) right after a wizard submission and (b) from the Sync
 * Queue screen's "Sync Now" button. All requests share [NETWORK_CONSTRAINTS] so WorkManager
 * itself is the "sync automatically when a connection is available" mechanism the README asks
 * for — no manual connectivity polling needed.
 */
object SyncScheduler {
    private const val PERIODIC_WORK_NAME = "tpm-sync-periodic"
    private const val ONE_TIME_WORK_NAME = "tpm-sync-now"

    private val NETWORK_CONSTRAINTS = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES)
            .setConstraints(NETWORK_CONSTRAINTS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request,
        )
    }

    /** Fire immediately after a submission, or from "Sync Now" — a no-op until connectivity returns
     *  if the device is offline, since [NETWORK_CONSTRAINTS] gates the actual run.
     *
     *  APPEND_OR_REPLACE, not REPLACE and not KEEP:
     *  - Not REPLACE — a second call (e.g. impatiently tapping "Sync Now" again while a photo is
     *    mid-upload) must never cancel a run already in progress. REPLACE did exactly that,
     *    tearing down the in-flight CoroutineWorker's Job and restarting the whole submission from
     *    the top every time, which could make an upload-heavy push never actually finish if tapped
     *    more than once.
     *  - Not KEEP either — SyncWorker.doWork() snapshots pendingSyncItemsOldestFirst() once at the
     *    start of a run, so a new submission created *while* a big batch is already syncing
     *    wouldn't be in that snapshot. KEEP would silently drop this call in that case (an
     *    in-progress run counts as "existing pending work"), leaving the new item stranded until
     *    the 30-minute periodic safety net happens to fire — precisely the "large batch blocks
     *    newer records" failure mode. APPEND_OR_REPLACE queues a follow-up run right after the
     *    current one finishes instead: never cancels what's in flight, but guarantees the new item
     *    gets picked up promptly rather than waiting on the periodic schedule. Extra chained runs
     *    are cheap — doWork() returns immediately once the queue is empty. */
    fun syncNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(NETWORK_CONSTRAINTS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            ONE_TIME_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request,
        )
    }
}
