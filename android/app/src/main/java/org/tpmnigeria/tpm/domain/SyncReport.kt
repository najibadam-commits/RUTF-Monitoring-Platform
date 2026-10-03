package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.SyncQueueItem
import org.tpmnigeria.tpm.domain.model.SyncStatus
import java.time.Instant

/**
 * What the app tells the server after every sync run (web migration 0108, `report_sync_status`):
 * how much is still waiting, and which submissions keep failing and why — so an administrator
 * sees a stuck phone on Offline Sync Health before the facility's figures go missing. Carries no
 * submission content, only the queue key, its type and a cleaned-up error line.
 */
data class SyncReport(
    val pending: Int,
    val failed: Int,
    val oldestPendingAt: String?,
    val failures: List<Failure>,
) {
    data class Failure(val localId: String, val type: String, val error: String?, val attempts: Int, val queuedAt: String)
}

const val MAX_REPORTED_FAILURES = 50
private const val MAX_ERROR_LENGTH = 300
private val TOKEN_LIKE = Regex("""eyJ[\w-]+\.[\w-]+\.[\w-]+|(?i)(bearer|apikey)[=:\s]+\S+""")

/** First line of an exception message, without anything that looks like a key or token (the
 *  client library appends request URL and headers on later lines), capped at 300 characters. */
fun cleanSyncError(message: String?): String? =
    message?.lineSequence()?.firstOrNull { it.isNotBlank() }
        ?.replace(TOKEN_LIKE, "[removed]")
        ?.trim()?.take(MAX_ERROR_LENGTH)

/** [items]: every queue row not yet synced (Pending or Failed); [errors]: the last error seen
 *  for a queue key during this run, by localId. A row counts as failing once it has failed at
 *  least one attempt; Failed rows (past the retry limit) are listed first. */
fun buildSyncReport(items: List<SyncQueueItem>, errors: Map<String, String?>): SyncReport {
    val waiting = items.filter { it.status != SyncStatus.Synced }
    val failing = waiting.filter { it.retryCount > 0 || it.status == SyncStatus.Failed }
        .sortedWith(compareByDescending<SyncQueueItem> { it.status == SyncStatus.Failed }.thenBy { it.timestampMillis })
    return SyncReport(
        pending = waiting.count { it.status == SyncStatus.Pending },
        failed = waiting.count { it.status == SyncStatus.Failed },
        oldestPendingAt = waiting.minOfOrNull { it.timestampMillis }?.let { Instant.ofEpochMilli(it).toString() },
        failures = failing.take(MAX_REPORTED_FAILURES).map {
            SyncReport.Failure(
                localId = it.localId,
                type = it.submissionType.name,
                error = cleanSyncError(errors[it.localId]),
                attempts = it.retryCount,
                queuedAt = Instant.ofEpochMilli(it.timestampMillis).toString(),
            )
        },
    )
}
