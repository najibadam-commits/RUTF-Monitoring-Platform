package org.tpmnigeria.tpm.data

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import org.tpmnigeria.tpm.data.local.AttendanceDao
import org.tpmnigeria.tpm.data.local.AttendanceEntity
import org.tpmnigeria.tpm.data.local.IssueDao
import org.tpmnigeria.tpm.data.local.IssueEntity
import org.tpmnigeria.tpm.data.local.IssueIdCounterDao
import org.tpmnigeria.tpm.data.local.NotificationDao
import org.tpmnigeria.tpm.data.local.NotificationEntity
import org.tpmnigeria.tpm.data.local.SyncQueueDao
import org.tpmnigeria.tpm.data.local.SyncQueueEntity
import org.tpmnigeria.tpm.data.local.toDomain
import org.tpmnigeria.tpm.data.local.toEntity
import org.tpmnigeria.tpm.domain.generateStructuredIssueId
import org.tpmnigeria.tpm.domain.model.AppNotification
import org.tpmnigeria.tpm.domain.model.DriResponse
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.HistoryEvent
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.SubmissionType
import org.tpmnigeria.tpm.domain.model.SyncQueueItem
import org.tpmnigeria.tpm.domain.model.SyncStatus
import org.tpmnigeria.tpm.domain.model.UserRole
import org.tpmnigeria.tpm.domain.model.Verification
import org.tpmnigeria.tpm.sync.SyncApiService
import org.tpmnigeria.tpm.sync.SyncScheduler
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * Single repository fronting Room for issues, notifications, and the offline sync queue. Every
 * write here is local-first: it commits to Room immediately and drops a row in sync_queue for
 * SyncWorker to push to Supabase later (see SyncApiService) — the compulsory wizard validation
 * that gates *reaching* these calls lives in the wizard ViewModels, not here. Reads (observeIssues
 * etc.) serve straight from Room too; keeping it populated with what Supabase/RLS actually shows
 * this account is AppRepository.pullRemoteIssues's job (called from SyncWorker and on login).
 */
class AppRepository(
    private val issueDao: IssueDao,
    private val notificationDao: NotificationDao,
    private val syncQueueDao: SyncQueueDao,
    private val issueIdCounterDao: IssueIdCounterDao,
    private val attendanceDao: AttendanceDao,
    private val appContext: Context,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val timeFmt = DateTimeFormatter.ofPattern("HH:mm")

    // ---- Reads ---------------------------------------------------------------------------------

    fun observeIssues(): Flow<List<Issue>> = issueDao.observeAll().map { list -> list.map { it.toDomain() } }

    fun observeIssue(id: String): Flow<Issue?> = issueDao.observeById(id).map { it?.toDomain() }

    suspend fun getIssue(id: String): Issue? = issueDao.getById(id)?.toDomain()

    /** Field Monitor lookup for the DRI Response wizard: any issue not yet closed. */
    suspend fun findIssueForDriLookup(rawId: String): Result<Issue> {
        val entity = issueDao.findByIdCaseInsensitive(rawId.trim())
            ?: return Result.failure(NoSuchElementException("No finding found with that ID."))
        if (entity.status == IssueStatus.VerifiedClosed) {
            return Result.failure(IllegalStateException("This finding is already closed."))
        }
        return Result.success(entity.toDomain())
    }

    /** Field Monitor lookup for the Final Verification wizard: must be awaiting verification. */
    suspend fun findIssueForVerification(rawId: String): Result<Issue> {
        val entity = issueDao.findByIdCaseInsensitive(rawId.trim())
            ?: return Result.failure(NoSuchElementException("No finding found with that ID."))
        if (entity.status != IssueStatus.ResolvedPendingVerification) {
            return Result.failure(IllegalStateException("This finding is not awaiting verification."))
        }
        return Result.success(entity.toDomain())
    }

    fun observeAssignableForDri(): Flow<List<Issue>> = observeIssues().map { list ->
        list.filter { it.status == IssueStatus.New || it.status == IssueStatus.Ongoing || it.status == IssueStatus.Reopened }
    }

    fun observePendingVerification(): Flow<List<Issue>> = observeIssues().map { list ->
        list.filter { it.status == IssueStatus.ResolvedPendingVerification }
    }

    fun observeNotifications(role: UserRole): Flow<List<AppNotification>> =
        notificationDao.observeForRole(role).map { list -> list.map { it.toDomain() } }

    suspend fun markNotificationRead(id: Long) = notificationDao.markRead(id)

    fun observeSyncQueue(): Flow<List<SyncQueueItem>> = syncQueueDao.observeAll().map { list -> list.map { it.toDomain() } }

    fun observePendingSyncCount(): Flow<Int> = syncQueueDao.observePendingCount()

    /** Oldest-first — a DRI Response/Final Verification submission can't push before the New
     *  Issue submission that created its target row, so SyncWorker must process in creation
     *  order, not display order (observeSyncQueue is newest-first, for the UI). */
    suspend fun pendingSyncItemsOldestFirst(): List<SyncQueueItem> =
        syncQueueDao.getByStatus(SyncStatus.Pending).sortedBy { it.timestampMillis }.map { it.toDomain() }

    /** Called by SyncWorker after a successful push. The Sync Queue screen's "Sync Now" button
     *  goes through SyncScheduler.syncNow(context), which enqueues an immediate SyncWorker run —
     *  not this method directly. */
    suspend fun markSynced(localId: String) = syncQueueDao.updateStatus(localId, SyncStatus.Synced)

    /** Called by SyncWorker after a failed push. Below MAX_SYNC_RETRIES this is a no-op status-wise
     *  (stays Pending so WorkManager's own backoff keeps retrying) — past it, the row flips to
     *  Failed so it stops being retried forever and becomes visible to the user as needing
     *  attention (see SyncQueueScreen's manual "Retry" action / [retrySyncItem]). */
    suspend fun recordFailedSyncAttempt(localId: String) = syncQueueDao.recordFailedAttempt(localId, MAX_SYNC_RETRIES)

    /** User tapped "Retry" on a Failed row in the Sync Queue screen. */
    suspend fun retrySyncItem(localId: String) = syncQueueDao.resetForRetry(localId)

    // ---- Sync cursor (incremental pull) -----------------------------------------------------

    private val syncPrefs by lazy { appContext.getSharedPreferences("sync_cursor", Context.MODE_PRIVATE) }

    /** Server `updated_at` watermark of the most recent [SyncApiService.pullIssues] — lets that
     *  pull ask Supabase for only what changed since last time instead of re-fetching every issue
     *  this account can see on every single sync run. Null on first run (or after a fresh
     *  install/logout+login), which the caller treats as "pull everything." */
    fun getLastPulledAt(): String? = syncPrefs.getString(KEY_LAST_PULLED_AT, null)

    fun setLastPulledAt(updatedAt: String) {
        syncPrefs.edit().putString(KEY_LAST_PULLED_AT, updatedAt).apply()
    }

    companion object {
        const val MAX_SYNC_RETRIES = 5
        private const val KEY_LAST_PULLED_AT = "last_pulled_at"
    }

    /** Upserts issues pulled from Supabase (filtered by RLS to what this account can see) into
     *  the local cache — see SyncApiService.pullIssues / SyncWorker. Local rows with pending
     *  outgoing changes are left alone by the caller (it only pulls issues this device didn't
     *  just create/modify itself — see the remoteId-null check there). */
    suspend fun upsertRemoteIssues(issues: List<Issue>) = issueDao.insertAll(issues.map { it.toEntity() })

    suspend fun getByRemoteId(remoteId: String): Issue? = issueDao.getByRemoteId(remoteId)?.toDomain()

    /** Reconciliation pass — see SupabaseSyncApiService.pullIssues' kdoc and DECISIONS.md #27.
     *  [currentlyVisibleRemoteIds] is a full (non-delta) sweep of every remote id this account can
     *  see right now; anything synced locally but absent from it has fallen out of scope (RLS
     *  visibility narrowed — a DRI reassigned away, a sector/state-coordinator scope change, a
     *  deletion, ...) and must not keep showing on this device. Never touches an unsynced local
     *  draft (remoteId still null). */
    suspend fun pruneIssuesNotVisible(currentlyVisibleRemoteIds: Set<String>) {
        if (currentlyVisibleRemoteIds.isEmpty()) {
            issueDao.deleteAllSynced()
        } else {
            issueDao.deleteSyncedNotIn(currentlyVisibleRemoteIds.toList())
        }
    }

    suspend fun updateIssue(issue: Issue) = issueDao.update(issue.toEntity())

    suspend fun refreshIssue(issueId: String, apiService: SyncApiService) {
        val existing = getIssue(issueId) ?: return
        val remoteId = existing.remoteId ?: return
        apiService.pullIssueDetail(remoteId)
    }

    /** See NotificationEntity's kdoc — inserts pulled remote notifications, silently skipping
     *  ones already seen (does not overwrite local read state; marking read here doesn't sync
     *  back to Supabase's own `read` column — a known, documented gap, not silently missing). */
    suspend fun upsertRemoteNotifications(notifications: List<NotificationEntity>) =
        notificationDao.insertIgnoringDuplicates(notifications)

    // ---- Writes: Register New Issue (Field Monitor) --------------------------------------------

    /**
     * Location is exactly one of: a Settlement (settlementId+settlement), an Activity Site
     * (siteId+site), or a manually-typed [locationOther] when the real place wasn't in the
     * preloaded reference list for the Ward — see NewIssueWizardViewModel's merged picker and
     * supabase/migrations/0020_issue_location_other.sql. The other two are left null/blank.
     */
    suspend fun submitNewIssue(
        stateId: String, stateName: String,
        lgaId: String, lgaName: String, lgaAbbr: String?,
        wardId: String, wardName: String, wardAbbr: String?,
        settlementId: String? = null, settlement: String? = null,
        siteId: String? = null, site: String? = null,
        locationOther: String? = null,
        categoryId: String, category: String, categoryAbbr: String?,
        severity: Severity, description: String, date: LocalDate,
        gps: GpsCapture, movPhotoPath: String, selfiePhotoPath: String, reporterName: String,
    ): Issue {
        // year = date.year (the issue's actual reported date), not "now" — matches the server's
        // own generate_issue_id(), which uses reported_at rather than the insert-time clock.
        val id = generateStructuredIssueId(issueIdCounterDao, lgaAbbr, wardAbbr, categoryAbbr, reporterName, date.year)
        val locationLabel = site ?: settlement ?: locationOther.orEmpty()
        val issue = Issue(
            id = id, state = stateName, stateId = stateId, lga = lgaName, lgaId = lgaId,
            ward = wardName, wardId = wardId,
            settlement = settlement.orEmpty(), settlementId = settlementId,
            site = site.orEmpty(), siteId = siteId, locationOther = locationOther,
            category = category, categoryId = categoryId, severity = severity, description = description,
            // PendingReview, not New — matches the server's own default for a freshly-inserted
            // Finding (issues.status default, migration 0032) now that every new submission goes
            // through State Coordinator review first. See DECISIONS.md #22.
            reporter = reporterName, dateReported = date, gpsIssue = gps, status = IssueStatus.PendingReview,
            movPhotoPath = movPhotoPath, selfiePhotoPath = selfiePhotoPath,
            history = listOf(HistoryEvent("Finding Registered", reporterName, date.toString(), nowTime(), locationLabel)),
        )
        issueDao.upsert(issue.toEntity())
        enqueueSync(id, SubmissionType.NewIssue, issue = issue)
        return issue
    }

    // ---- Writes: DRI Response --------------------------------------------------------------------

    suspend fun submitDriResponse(
        issueId: String, driId: String, driName: String, designation: String, action: String, date: LocalDate,
        gps: GpsCapture, resolved: Boolean, movPhotoPath: String, selfiePhotoPath: String,
    ): Issue {
        val existing = issueDao.getById(issueId)?.toDomain() ?: error("Finding $issueId not found")
        val newStatus = if (resolved) IssueStatus.ResolvedPendingVerification else IssueStatus.Ongoing
        val events = buildList {
            add(HistoryEvent("DRI Response Logged", driName, date.toString(), nowTime(), existing.site))
            if (resolved) add(HistoryEvent("DRI Marked Resolved", driName, date.toString(), nowTime(), existing.site))
        }
        val updated = existing.copy(
            status = newStatus,
            assignedDriId = existing.assignedDriId ?: driId,
            driResponse = DriResponse(
                name = driName, designation = designation, action = action, date = date.toString(),
                gps = gps, status = if (resolved) "Resolved" else "Ongoing",
                movPhotoPath = movPhotoPath, selfiePhotoPath = selfiePhotoPath,
            ),
            history = existing.history + events,
        )
        issueDao.update(updated.toEntity())
        if (resolved) {
            notificationDao.insert(
                NotificationEntity(
                    role = UserRole.FieldMonitor, issueId = issueId,
                    title = "Finding awaiting your verification",
                    body = "DRI marked $issueId as resolved.",
                    timestampMillis = System.currentTimeMillis(), unread = true,
                ),
            )
        }
        enqueueSync(issueId, SubmissionType.DriResponse, issue = updated)
        return updated
    }

    // ---- Writes: Final Verification (Field Monitor) ----------------------------------------------

    suspend fun submitVerification(
        issueId: String, confirmed: Boolean, comment: String, date: LocalDate, gps: GpsCapture,
        selfiePhotoPath: String, movPhotoPath: String?, verifierName: String,
    ): Issue {
        val existing = issueDao.getById(issueId)?.toDomain() ?: error("Finding $issueId not found")
        val newStatus = if (confirmed) IssueStatus.VerifiedClosed else IssueStatus.Reopened
        val events = if (confirmed) {
            listOf(HistoryEvent("Final Verification — Confirmed Resolved", verifierName, date.toString(), nowTime(), existing.site))
        } else {
            listOf(
                HistoryEvent("Final Verification — Not Resolved", verifierName, date.toString(), nowTime(), existing.site),
                HistoryEvent("Finding Reopened", "System", date.toString(), nowTime(), "—"),
            )
        }
        val updated = existing.copy(
            status = newStatus,
            verification = Verification(
                confirmed = confirmed, comment = comment, date = date.toString(), gps = gps,
                selfiePhotoPath = selfiePhotoPath, movPhotoPath = movPhotoPath,
            ),
            history = existing.history + events,
        )
        issueDao.update(updated.toEntity())
        if (!confirmed) {
            notificationDao.insert(
                NotificationEntity(
                    role = UserRole.Dri, issueId = issueId,
                    title = "Additional action required",
                    body = "Supervisor rejected your resolution on $issueId.",
                    timestampMillis = System.currentTimeMillis(), unread = true,
                ),
            )
        }
        enqueueSync(issueId, SubmissionType.FinalVerification, issue = updated)
        return updated
    }

    // ---- Writes: Daily Attendance (Field Monitor) ----------------------------------------------

    /** Fast, offline-capable duplicate check for the capture screen — see AttendanceEntity's
     *  kdoc; the server's own `unique(field_monitor_id, attendance_date)` constraint is the real
     *  boundary this only mirrors locally. */
    suspend fun findTodaysAttendance(fieldMonitorId: String, attendanceDate: LocalDate) =
        attendanceDao.findForFieldMonitorAndDate(fieldMonitorId, attendanceDate.toString())

    suspend fun submitAttendance(
        fieldMonitorId: String, attendanceDate: LocalDate,
        gps: GpsCapture, selfiePhotoPath: String, assignmentLocationPhotoPath: String, deviceId: String,
    ): AttendanceEntity {
        val localId = "att-$fieldMonitorId-$attendanceDate"
        val entity = AttendanceEntity(
            localId = localId,
            remoteId = null,
            fieldMonitorId = fieldMonitorId,
            attendanceDate = attendanceDate.toString(),
            capturedAtMillis = System.currentTimeMillis(),
            lat = gps.lat,
            lng = gps.lng,
            gpsAccuracyM = gps.accuracyMeters,
            selfiePhotoPath = selfiePhotoPath,
            assignmentLocationPhotoPath = assignmentLocationPhotoPath,
            deviceId = deviceId,
        )
        attendanceDao.insert(entity)
        enqueueAttendanceSync(localId)
        return entity
    }

    suspend fun getAttendance(localId: String): AttendanceEntity? = attendanceDao.getById(localId)

    suspend fun markAttendanceRemoteId(localId: String, remoteId: String) = attendanceDao.setRemoteId(localId, remoteId)

    // ---- Helpers ---------------------------------------------------------------------------------

    /**
     * [issue] is intentionally not serialized into the queue row: SyncWorker re-reads the
     * current issue from Room by [issueId] at sync time, so a frozen snapshot here would just
     * risk going stale if the issue changes again before sync runs. payloadJson carries only the
     * lightweight summary useful for the Sync Queue screen and debugging.
     */
    private suspend fun enqueueSync(issueId: String, type: SubmissionType, issue: Issue) {
        val entity = SyncQueueEntity(
            localId = "sq-${System.currentTimeMillis()}-$issueId",
            issueId = issueId,
            submissionType = type,
            status = SyncStatus.Pending, // Always start as Pending until SyncWorker confirms success
            timestampMillis = System.currentTimeMillis(),
            payloadJson = json.encodeToString(SyncPayloadSummary(issueId, type.name, issue.status.name)),
        )
        syncQueueDao.insert(entity)
        // This was the actual root cause of "sync takes a long time": nothing here ever asked
        // WorkManager to run — a submission just sat as Pending until the 30-minute periodic
        // safety net happened to fire, the user logged in/out, or they manually tapped Sync Now.
        // enqueueUniqueWork's NETWORK_CONSTRAINTS still gate the real run (offline = no-op until
        // connectivity returns, exactly per README), so this is safe to call unconditionally.
        SyncScheduler.syncNow(appContext)
    }

    /** Same shape as [enqueueSync] but there is no Issue to snapshot into payloadJson — the
     *  Attendance record's own localId doubles as the Sync Queue screen's display label (see
     *  SyncQueueItem's kdoc) and as [SupabaseSyncApiService][org.tpmnigeria.tpm.sync.SupabaseSyncApiService]'s
     *  lookup key for the row it needs to push. */
    private suspend fun enqueueAttendanceSync(attendanceLocalId: String) {
        val entity = SyncQueueEntity(
            localId = "sq-${System.currentTimeMillis()}-$attendanceLocalId",
            issueId = attendanceLocalId,
            submissionType = SubmissionType.Attendance,
            status = SyncStatus.Pending,
            timestampMillis = System.currentTimeMillis(),
            payloadJson = json.encodeToString(SyncPayloadSummary(attendanceLocalId, SubmissionType.Attendance.name, "n/a")),
        )
        syncQueueDao.insert(entity)
        SyncScheduler.syncNow(appContext)
    }

    private fun nowTime(): String = LocalTime.now().format(timeFmt)
}

/** Sync Queue screen display + debugging summary — see enqueueSync's kdoc. */
@Serializable
private data class SyncPayloadSummary(
    val issueId: String,
    val submissionType: String,
    val issueStatus: String,
)
