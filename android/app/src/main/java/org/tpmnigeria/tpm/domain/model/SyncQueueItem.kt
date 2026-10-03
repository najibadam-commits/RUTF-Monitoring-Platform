package org.tpmnigeria.tpm.domain.model

/**
 * One row per offline-queued submission — README "State & Data Notes": "a separate sync-queue
 * table (localId, issueId, submission type, status: pending/synced, timestamp)".
 *
 * [issueId] holds a Finding's id for the three Finding-workflow [SubmissionType]s. For
 * [SubmissionType.Attendance] there is no Finding involved at all — it holds the local
 * AttendanceEntity's `localId` instead (only ever used here as a queue key + the Sync Queue
 * screen's display label, e.g. "att-<uid>-2026-09-12"; see SupabaseSyncApiService.pushSubmission,
 * which branches on submissionType before doing anything Finding-specific with this field).
 */
data class SyncQueueItem(
    val localId: String,
    val issueId: String,
    val submissionType: SubmissionType,
    val status: SyncStatus,
    val timestampMillis: Long,
    /** The full payload this submission would send to the backend once one exists — see TODO(backend) in SyncApiService. */
    val payloadJson: String,
    /** Consecutive failed push attempts. SyncStatus.Failed existed as a state but nothing ever
     *  actually set it — a chronically-failing item (e.g. a genuinely invalid submission, not a
     *  transient network blip) retried forever, every sync run, permanently — see SyncWorker. */
    val retryCount: Int = 0,
)

/** Stored by name (Converters), so new values need no Room migration. The Stock* / Dispensing
 *  types carry a LedgerSubmission as payloadJson; [SyncQueueItem.issueId] is its localId. */
enum class SubmissionType {
    NewIssue, DriResponse, FinalVerification, Attendance,
    StockReceipt, StockIssue, Dispensing, StockCount, StockLoss,
    StoreCheck, OtpVerification, AdjustmentConfirmation,
}
enum class SyncStatus { Pending, Synced, Failed }
