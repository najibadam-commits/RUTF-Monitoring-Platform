package org.tpmnigeria.tpm.sync

import io.github.jan.supabase.postgrest.exception.PostgrestRestException
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.storage.storage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.data.LEDGER_SUBMISSION_TYPES
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.data.remote.LEDGER_EVIDENCE_BUCKET
import org.tpmnigeria.tpm.data.remote.dto.LedgerPhotoInsertDto
import org.tpmnigeria.tpm.domain.LedgerSubmission
import org.tpmnigeria.tpm.data.remote.ATTENDANCE_EVIDENCE_BUCKET
import org.tpmnigeria.tpm.data.remote.EvidenceStorage
import org.tpmnigeria.tpm.data.remote.ISSUE_EVIDENCE_BUCKET
import org.tpmnigeria.tpm.data.remote.Supabase
import org.tpmnigeria.tpm.data.remote.dto.AttendanceInsertDto
import org.tpmnigeria.tpm.data.remote.dto.AttendanceRemoteDto
import org.tpmnigeria.tpm.data.remote.dto.CategoryDto
import org.tpmnigeria.tpm.data.remote.dto.DriSelfAssignParams
import org.tpmnigeria.tpm.data.remote.dto.GpsCaptureInsertDto
import org.tpmnigeria.tpm.data.remote.dto.IssueIdDto
import org.tpmnigeria.tpm.data.remote.dto.IssueInsertDto
import org.tpmnigeria.tpm.data.remote.dto.IssuePullDto
import org.tpmnigeria.tpm.data.remote.dto.IssueRemoteDto
import org.tpmnigeria.tpm.data.remote.dto.IssueStatusRow
import org.tpmnigeria.tpm.data.remote.dto.LgaDto
import org.tpmnigeria.tpm.data.remote.dto.NotificationPullDto
import org.tpmnigeria.tpm.data.remote.dto.PhotoInsertDto
import org.tpmnigeria.tpm.data.remote.dto.RecordCorrectiveActionParams
import org.tpmnigeria.tpm.data.remote.dto.RejectAndReopenIssueParams
import org.tpmnigeria.tpm.data.remote.dto.StateDto
import org.tpmnigeria.tpm.data.remote.dto.SubmitDriResponseParams
import org.tpmnigeria.tpm.data.remote.dto.VerifyAndCloseIssueParams
import org.tpmnigeria.tpm.data.remote.dto.WardDto
import org.tpmnigeria.tpm.domain.model.DriResponse
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.HistoryEvent
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.SubmissionType
import org.tpmnigeria.tpm.domain.model.SyncQueueItem
import org.tpmnigeria.tpm.domain.model.Verification
import org.tpmnigeria.tpm.data.local.NotificationEntity
import org.tpmnigeria.tpm.domain.isSupabaseUuid
import org.tpmnigeria.tpm.domain.toVerification
import org.tpmnigeria.tpm.domain.priorityToSeverity
import org.tpmnigeria.tpm.domain.remoteStatusToIssueStatus
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.session.CurrentUser
import java.io.File
import java.time.Instant

/**
 * Real push implementation against the TPM Monitoring Platform Supabase project — replaces
 * [StubSyncApiService]. See DECISIONS.md #7 in the web project for the workflow reconciliation
 * this implements (DRI self-assign, reject-and-reopen, severity→priority mapping, per-stage GPS,
 * MOV/selfie photo kind+stage).
 */
class SupabaseSyncApiService(
    private val repository: AppRepository,
    private val session: AppSession,
    private val stockRepository: StockRepository,
) : SyncApiService {
    private val ledgerJson = Json { ignoreUnknownKeys = true }
    private val postgrest get() = Supabase.client.postgrest
    private val storage get() = Supabase.client.storage

    override suspend fun pullIssues() {
        // Delta pull: only ask for rows the server has touched since our last successful pull
        // (issues.updated_at is trigger-maintained on every UPDATE, including the RPC-driven
        // status transitions — see 0007_functions_and_triggers.sql). Every prior version of this
        // re-fetched everything this account can see on every single SyncWorker run, which is
        // most of what made "sync" feel slow on a large, growing issues table.
        val lastPulledAt = repository.getLastPulledAt()
        // Paged, not a single limit(300): the watermark below is the newest updated_at in what we
        // fetched, so a capped first page would advance it past rows that were never fetched and
        // they'd never be pulled. A Field Monitor/DRI sees a few dozen Findings so this never
        // mattered; Super Admin (everything) and Project Admin (a whole project) can exceed a page.
        // Keyset (not offset) paging on updated_at: a row updated mid-pull jumps to the end of the
        // ordering and would shift later rows left under an offset, skipping one past the
        // watermark for good. `gte` at the cursor re-reads rows tied on the boundary timestamp;
        // they're de-duplicated by id. If a full page doesn't advance the cursor at all (hundreds
        // of rows sharing one timestamp) it falls back to strict `gt` so the loop always ends.
        val byId = LinkedHashMap<String, IssuePullDto>()
        var cursor = lastPulledAt
        var inclusive = false
        while (true) {
            val page = postgrest.from("issues")
                .select(columns = Columns.raw("*, categories(name), states(name), lgas(name)")) {
                    order("updated_at", Order.ASCENDING)
                    order("id", Order.ASCENDING)
                    val floor = cursor
                    if (floor != null) {
                        filter { if (inclusive) gte("updated_at", floor) else gt("updated_at", floor) }
                    }
                    limit(PULL_PAGE_SIZE)
                }
                .decodeList<IssuePullDto>()
            page.forEach { byId[it.id] = it }
            if (page.size < PULL_PAGE_SIZE) break
            val next = page.last().updated_at
            inclusive = next != cursor
            cursor = next
        }
        val rows = byId.values.toList()

        val toUpsert = rows.map { row ->
            val existingLocal = repository.getByRemoteId(row.id)
            if (existingLocal != null) {
                existingLocal.copy(
                    status = remoteStatusToIssueStatus(row.status),
                    assignedDriId = row.assigned_dri ?: existingLocal.assignedDriId,
                    remoteCode = row.code,
                )
            } else {
                row.toNewLocalIssue()
            }
        }
        repository.upsertRemoteIssues(toUpsert)
        // Watermark = the newest updated_at actually seen in this batch, not "now" — using
        // wall-clock time would silently drop any row updated between this query starting and
        // its response arriving. Left untouched when nothing changed (rows empty).
        rows.maxOfOrNull { it.updated_at }?.let { repository.setLastPulledAt(it) }
        reconcileLocalIssues()
        pullNotifications()
    }

    /**
     * A delta pull only ever adds/updates rows the server reports as changed — it never removes
     * one that simply stops being returned. That's a real gap once RLS visibility can *narrow*
     * for reasons other than the row itself changing: a DRI gets reassigned away from a Finding,
     * their `assigned_category_id` (sector) changes, a State Coordinator's `managed_state_id`
     * changes, or a Finding is deleted outright — none of those necessarily bump the row's own
     * `updated_at` in a way this device's delta pull would ever see as "gone." Confirmed live: a
     * DRI test account kept showing a Finding from before the sector-scoping RLS rewrite
     * (migration 0032) that current RLS would never return to it. See DECISIONS.md #27.
     *
     * Fetches every id this account can currently see (RLS-scoped, no other filter — the same
     * authoritative answer the delta pull's own listing would give with no `updated_at` floor),
     * paginated past PostgREST's default 1000-row response cap so this stays correct even if an
     * account's visible set ever grows past that, then deletes any locally-synced Finding whose
     * remoteId isn't in that set. Unsynced local-only drafts (remoteId still null) are never
     * touched — see AppRepository.pruneIssuesNotVisible / IssueDao.deleteSyncedNotIn.
     */
    private suspend fun reconcileLocalIssues() {
        val visibleIds = mutableSetOf<String>()
        var offset = 0L
        val pageSize = 1000L
        while (true) {
            val page = postgrest.from("issues")
                .select(columns = Columns.raw("id")) { range(offset, offset + pageSize - 1) }
                .decodeList<IssueIdDto>()
            visibleIds += page.map { it.id }
            if (page.size < pageSize) break
            offset += pageSize
        }
        repository.pruneIssuesNotVisible(visibleIds)
    }

    override suspend fun pullIssueDetail(remoteId: String) {
        val row = postgrest.from("issues")
            .select(columns = Columns.raw("*, categories(name), states(name), lgas(name), issue_history(*), issue_gps_captures(*), issue_photos(*)")) {
                filter { eq("id", remoteId) }
            }
            .decodeSingle<IssuePullDto>()

        val existing = repository.getByRemoteId(remoteId)
        val updated = if (existing != null) {
            row.toUpdatedLocalIssue(existing)
        } else {
            row.toNewLocalIssue()
        }
        repository.updateIssue(updated)
    }

    private suspend fun pullNotifications() {
        val role = session.currentUser.value?.role ?: return
        val rows = postgrest.from("notifications")
            .select(columns = Columns.list("id", "type", "text", "issue_id", "read", "created_at")) {
                order("created_at", Order.DESCENDING)
                limit(100)
            }
            .decodeList<NotificationPullDto>()

        repository.upsertRemoteNotifications(
            rows.map { row ->
                NotificationEntity(
                    remoteId = row.id,
                    role = role,
                    issueId = row.issue_id.orEmpty(),
                    title = notificationTitleFor(row.type),
                    body = row.text,
                    timestampMillis = runCatching { Instant.parse(row.created_at).toEpochMilli() }
                        .getOrElse { System.currentTimeMillis() },
                    unread = !row.read,
                )
            },
        )
    }

    private fun notificationTitleFor(type: String): String = when (type) {
        "assignment" -> "New finding assigned"
        "resolved" -> "Finding awaiting your verification"
        "reopened" -> "Additional action required"
        // State Coordinator review (web-only) returning a Field Monitor's submission for
        // correction — see DECISIONS.md #22's return_finding_for_correction.
        "returned" -> "Finding returned for correction"
        else -> "Notification"
    }

    private fun IssuePullDto.toNewLocalIssue(): Issue {
        val lat = lat ?: 0.0
        val lng = lng ?: 0.0
        val severity = priorityToSeverity(priority)
        val status = remoteStatusToIssueStatus(status)
        val siteLabel = activity_site ?: settlement ?: location_other ?: lgas?.name ?: "—"
        
        val gpsDiscovery = issue_gps_captures.find { it.stage == "discovery" }
        val discoveryLat = gpsDiscovery?.lat ?: lat
        val discoveryLng = gpsDiscovery?.lng ?: lng
        val discoveryAcc = gpsDiscovery?.accuracy_m?.toInt() ?: 0

        val movPhoto = issue_photos.find { it.stage == "discovery" && it.kind == "mov" }?.storage_path?.let { EvidenceStorage.reference(it) }
        val selfiePhoto = issue_photos.find { it.stage == "discovery" && it.kind == "selfie" }?.storage_path?.let { EvidenceStorage.reference(it) }

        val driRespAction = dri_response ?: issue_history.find { it.action == "Response submitted" }?.note
        val driRespGps = issue_gps_captures.find { it.stage == "dri_response" }
        val driRespPhotos = issue_photos.filter { it.stage == "dri_response" }

        return Issue(
            id = mobile_code ?: code,
            remoteId = id,
            remoteCode = code,
            state = states?.name ?: "",
            stateId = state_id,
            lga = lgas?.name ?: "",
            lgaId = lga_id,
            ward = ward ?: "",
            wardId = ward_id,
            settlement = settlement ?: "",
            settlementId = settlement_id,
            site = activity_site ?: "",
            siteId = activity_site_id,
            locationOther = location_other,
            category = categories?.name ?: "",
            categoryId = category_id,
            severity = severity,
            description = description,
            // Matches both "Finding reported" (current, migration 0035) and "Issue reported"
            // (pre-migration rows, kept as-is server-side to preserve history — see DECISIONS.md #22).
            reporter = issue_history.find { it.action == "Finding reported" || it.action == "Issue reported" }?.actor_label ?: "",
            dateReported = reported_at.take(10).let { java.time.LocalDate.parse(it) },
            gpsIssue = GpsCapture(discoveryLat, discoveryLng, discoveryAcc),
            status = status,
            assignedDriId = assigned_dri,
            movPhotoPath = movPhoto,
            selfiePhotoPath = selfiePhoto,
            driResponse = driRespAction?.let { action ->
                DriResponse(
                    name = issue_history.find { it.action == "Response submitted" }?.actor_label ?: "",
                    designation = "", // extracted from note if needed
                    action = action,
                    date = issue_history.find { it.action == "Response submitted" }?.occurred_at?.take(10) ?: reported_at.take(10),
                    gps = GpsCapture(driRespGps?.lat ?: lat, driRespGps?.lng ?: lng, driRespGps?.accuracy_m?.toInt() ?: 0),
                    status = if (corrective_action != null) "Resolved" else "Ongoing",
                    movPhotoPath = driRespPhotos.find { it.kind == "mov" }?.storage_path?.let { EvidenceStorage.reference(it) },
                    selfiePhotoPath = driRespPhotos.find { it.kind == "selfie" }?.storage_path?.let { EvidenceStorage.reference(it) },
                )
            },
            verification = toVerification(status),
            history = if (issue_history.isEmpty()) {
                listOf(HistoryEvent("Finding reported", "", reported_at.take(10), "", siteLabel))
            } else {
                issue_history.map { h ->
                    HistoryEvent(
                        event = h.action,
                        user = h.actor_label,
                        date = h.occurred_at.take(10),
                        time = h.occurred_at.substring(11, 16),
                        location = if (h.action == "Finding reported" || h.action == "Issue reported") siteLabel else "",
                    )
                }
            },
        )
    }

    private fun IssuePullDto.toUpdatedLocalIssue(existing: Issue): Issue {
        val full = toNewLocalIssue()
        return existing.copy(
            status = full.status,
            assignedDriId = full.assignedDriId,
            remoteCode = full.remoteCode,
            // The device that took a photo keeps showing its own local file (works offline, no
            // signed-URL round trip); anyone else gets the Storage reference.
            movPhotoPath = existing.movPhotoPath.takeIfLocalFile() ?: full.movPhotoPath ?: existing.movPhotoPath,
            selfiePhotoPath = existing.selfiePhotoPath.takeIfLocalFile() ?: full.selfiePhotoPath ?: existing.selfiePhotoPath,
            driResponse = full.driResponse?.keepingLocalPhotos(existing.driResponse) ?: existing.driResponse,
            verification = full.verification?.keepingLocalPhotos(existing.verification) ?: existing.verification,
            history = if (full.history.size > existing.history.size) full.history else existing.history,
            gpsIssue = full.gpsIssue,
        )
    }

    override suspend fun afterSync() {
        val user = session.currentUser.value ?: return
        stockRepository.refresh(user.facilityId)
    }

    /**
     * Facility stock: one call to the submission's record_* function (web migration 0101), then
     * its photos. The server is idempotent on the submission's localId — a retry after a lost
     * response, or after only the photos failed, gets "duplicate" back and simply carries on — so
     * this never records anything twice (M2 acceptance: no duplicates after forced retries).
     */
    private suspend fun pushLedger(item: SyncQueueItem): Boolean {
        if (session.currentUser.value == null) return false
        return try {
            val submission = ledgerJson.decodeFromString(LedgerSubmission.serializer(), item.payloadJson)
            postgrest.rpc(submission.rpc, submission.params)
            for (photo in submission.photos) uploadLedgerPhoto(submission, photo.localPath, photo.kind)
            true
        } catch (e: Exception) {
            android.util.Log.e("SupabaseSyncApiService", "Ledger push failed for ${item.issueId}: ${e.message}", e)
            false
        }
    }

    /** Path {facility_id}/{submission local_id}/{kind}.jpg — the bucket's insert policy requires the
     *  first segment to be the user's own facility (DECISIONS R25). */
    private suspend fun uploadLedgerPhoto(submission: LedgerSubmission, localPath: String, kind: String) {
        val storagePath = "${submission.facilityId}/${submission.localId}/$kind.jpg"
        val already = postgrest.from("ledger_photos").select(columns = Columns.list("id")) {
            filter { eq("storage_path", storagePath) }
        }.decodeList<IssueIdDto>().isNotEmpty()
        if (already) return
        val file = File(localPath)
        if (!file.exists()) return // nothing left to send (e.g. app data cleared) — don't block the queue
        try {
            storage.from(LEDGER_EVIDENCE_BUCKET).upload(storagePath, file.readBytes()) { upsert = false }
        } catch (e: Exception) {
            // An earlier attempt uploaded the object but didn't get to the table row.
            if (e.message?.contains("exists", ignoreCase = true) != true && e.message?.contains("Duplicate", ignoreCase = true) != true) throw e
        }
        try {
            postgrest.from("ledger_photos").insert(
                LedgerPhotoInsertDto(submission.localId, submission.facilityId, storagePath, kind, size_bytes = file.length()),
            )
        } catch (e: PostgrestRestException) {
            if (e.code != "23505") throw e
        }
    }

    override suspend fun pushSubmission(item: SyncQueueItem): Boolean {
        if (item.submissionType in LEDGER_SUBMISSION_TYPES.values) return pushLedger(item)

        // Attendance isn't a Finding at all — item.issueId holds an AttendanceEntity.localId for
        // this submission type (see SyncQueueItem's kdoc), so this must branch before the
        // getIssue() lookup below: that lookup would simply find nothing for an attendance id and
        // return true, silently marking the row "synced" without ever pushing it.
        if (item.submissionType == SubmissionType.Attendance) {
            if (session.currentUser.value == null) return false
            return try {
                pushAttendance(item.issueId)
                true
            } catch (e: Exception) {
                android.util.Log.e("SupabaseSyncApiService", "Attendance push failed for ${item.issueId}: ${e.message}", e)
                false
            }
        }

        val issue = repository.getIssue(item.issueId) ?: return true
        val user = session.currentUser.value ?: return false
        return try {
            when (item.submissionType) {
                SubmissionType.NewIssue -> pushNewIssue(issue, user)
                SubmissionType.DriResponse -> pushDriResponse(issue, user)
                SubmissionType.FinalVerification -> pushFinalVerification(issue, user)
                SubmissionType.Attendance -> Unit // handled above
                SubmissionType.StockReceipt, SubmissionType.StockIssue, SubmissionType.Dispensing,
                SubmissionType.StockCount, SubmissionType.StockLoss -> Unit // pushLedger, above
            }
            true
        } catch (e: Exception) {
            android.util.Log.e("SupabaseSyncApiService", "Push failed for ${item.issueId}: ${e.message}", e)
            false
        }
    }

    /**
     * Pushes one local AttendanceEntity. The row's own `id` is server-generated
     * (`default gen_random_uuid()`) and doesn't exist yet at upload time — so, like
     * [uploadPhoto]'s issue-scoped paths, the storage path here is keyed by
     * (`field_monitor_id`, `attendance_date`) instead: the same natural key the table itself is
     * unique on, fully known before either the upload or the DB write happen.
     *
     * A plain `insert`, not `upsert` — the table deliberately has no UPDATE policy at all
     * (immutable by design, see DECISIONS.md #24), so `ON CONFLICT DO UPDATE` would itself be
     * rejected by RLS on a genuine conflict. Idempotency across retries instead comes from
     * treating a 23505 (unique_violation on `unique(field_monitor_id, attendance_date)`) as
     * success: it means an earlier attempt already landed server-side even though this device
     * never got to record that locally (e.g. the response was lost to a dropped connection) —
     * there's nothing to reconcile against an immutable row, just look it up and stop retrying.
     */
    private suspend fun pushAttendance(localId: String) {
        val record = repository.getAttendance(localId) ?: return
        if (record.remoteId != null) return // already pushed — a retry landed after success

        val selfiePath = uploadAttendancePhoto(record.fieldMonitorId, record.attendanceDate, record.selfiePhotoPath, "selfie")
        val locationPath = uploadAttendancePhoto(record.fieldMonitorId, record.attendanceDate, record.assignmentLocationPhotoPath, "location")

        val dto = AttendanceInsertDto(
            field_monitor_id = record.fieldMonitorId,
            attendance_date = record.attendanceDate,
            captured_at = Instant.ofEpochMilli(record.capturedAtMillis).toString(),
            lat = record.lat,
            lng = record.lng,
            gps_accuracy_m = record.gpsAccuracyM.toDouble(),
            selfie_storage_path = selfiePath,
            assignment_location_storage_path = locationPath,
            device_id = record.deviceId,
        )

        val remoteId = try {
            postgrest.from("field_monitor_attendance").insert(dto) { select() }
                .decodeList<AttendanceRemoteDto>().firstOrNull()?.id
                ?: error("Attendance insert failed (no row returned)")
        } catch (e: PostgrestRestException) {
            if (e.code != "23505") throw e
            postgrest.from("field_monitor_attendance").select {
                filter { eq("field_monitor_id", record.fieldMonitorId); eq("attendance_date", record.attendanceDate) }
            }.decodeSingle<AttendanceRemoteDto>().id
        }

        repository.markAttendanceRemoteId(localId, remoteId)
    }

    /** Path's first segment must be the field monitor's own auth uid — see migration 0037's
     *  "attendance-evidence insert" policy's `(storage.foldername(name))[1] = auth.uid()::text`. */
    private suspend fun uploadAttendancePhoto(fieldMonitorId: String, attendanceDate: String, localPath: String, kind: String): String {
        val file = File(localPath)
        val storagePath = "$fieldMonitorId/$attendanceDate/$kind.jpg"
        if (file.exists()) {
            storage.from(ATTENDANCE_EVIDENCE_BUCKET).upload(storagePath, file.readBytes()) { upsert = true }
        }
        return storagePath
    }

    private suspend fun pushNewIssue(issue: Issue, user: CurrentUser) {
        if (issue.remoteId != null) return

        val resolvedStateId = resolveStateId(issue.stateId, issue.state)
        val resolvedLgaId = resolveLgaId(issue.lgaId, issue.lga, resolvedStateId)
        val resolvedWardId = resolveWardId(issue.wardId, issue.ward, resolvedLgaId)
        val resolvedCategoryId = resolveCategoryId(issue.categoryId, issue.category)

        if (resolvedStateId == null) error("Could not find Supabase UUID for state: ${issue.state}")
        if (resolvedLgaId == null) error("Could not find Supabase UUID for LGA: ${issue.lga}")
        if (resolvedCategoryId == null) error("Could not find Supabase UUID for category: ${issue.category}")

        android.util.Log.d("SupabaseSyncApiService", "Pushing new issue ${issue.id} for project ${user.projectId}")

        val inserted = postgrest.from("issues")
            .insert(
                IssueInsertDto(
                    category_id = resolvedCategoryId,
                    description = issue.description,
                    state_id = resolvedStateId,
                    lga_id = resolvedLgaId,
                    ward_id = resolvedWardId,
                    ward = issue.ward,
                    settlement_id = resolveSettlementId(issue.settlementId, issue.settlement, resolvedWardId),
                    settlement = issue.settlement.ifBlank { null },
                    activity_site_id = resolveSiteId(issue.siteId, issue.site, resolvedWardId),
                    activity_site = issue.site.ifBlank { null },
                    location_other = issue.locationOther,
                    lat = issue.gpsIssue.lat,
                    lng = issue.gpsIssue.lng,
                    priority = severityToPriority(issue.severity),
                    project_id = user.projectId,
                    reported_by = user.id,
                    mobile_code = issue.id,
                ),
            ) { select() }
            .decodeList<IssueRemoteDto>().firstOrNull() ?: error("Insert failed (no row returned)")

        repository.updateIssue(issue.copy(remoteId = inserted.id, remoteCode = inserted.code))

        insertGpsCapture(inserted.id, "discovery", issue.gpsIssue.lat, issue.gpsIssue.lng, issue.gpsIssue.accuracyMeters, user.id)
        issue.movPhotoPath?.let { uploadPhoto(inserted.id, it, "mov", "discovery", user.id) }
        issue.selfiePhotoPath?.let { uploadPhoto(inserted.id, it, "selfie", "discovery", user.id) }
    }

    private suspend fun resolveStateId(localId: String?, name: String): String? {
        if (isSupabaseUuid(localId)) return localId
        return postgrest.from("states").select { filter { eq("name", name.trim()) } }.decodeList<StateDto>().firstOrNull()?.id
    }

    private suspend fun resolveLgaId(localId: String?, name: String, stateId: String?): String? {
        if (isSupabaseUuid(localId)) return localId
        return postgrest.from("lgas").select {
            filter { 
                eq("name", name.trim())
                if (stateId != null) eq("state_id", stateId)
            }
        }.decodeList<LgaDto>().firstOrNull()?.id
    }

    private suspend fun resolveWardId(localId: String?, name: String, lgaId: String?): String? {
        if (isSupabaseUuid(localId)) return localId
        return postgrest.from("wards").select {
            filter {
                eq("name", name.trim())
                if (lgaId != null) eq("lga_id", lgaId)
            }
        }.decodeList<WardDto>().firstOrNull()?.id
    }

    private suspend fun resolveCategoryId(localId: String?, name: String): String? {
        if (isSupabaseUuid(localId)) return localId
        return postgrest.from("categories").select { filter { eq("name", name.trim()) } }.decodeList<CategoryDto>().firstOrNull()?.id
    }

    private suspend fun resolveSettlementId(localId: String?, name: String, wardId: String?): String? {
        if (isSupabaseUuid(localId)) return localId
        if (wardId == null || name.isBlank()) return null
        return try {
            postgrest.from("settlements").select {
                filter { eq("settlementname", name.trim()); eq("ward_id", wardId) }
            }.decodeList<org.tpmnigeria.tpm.data.remote.dto.SettlementDto>().firstOrNull()?.id
        } catch (e: Exception) { null }
    }

    private suspend fun resolveSiteId(localId: String?, name: String, wardId: String?): String? {
        if (isSupabaseUuid(localId)) return localId
        if (wardId == null || name.isBlank()) return null
        return try {
            postgrest.from("activity_sites").select {
                filter { eq("activitysitename", name.trim()); eq("ward_id", wardId) }
            }.decodeList<org.tpmnigeria.tpm.data.remote.dto.ActivitySiteDto>().firstOrNull()?.id
        } catch (e: Exception) { null }
    }

    private suspend fun pushDriResponse(issue: Issue, user: CurrentUser) {
        val remoteId = issue.remoteId ?: return
        val response = issue.driResponse ?: return

        val current = postgrest.from("issues").select { filter { eq("id", remoteId) } }.decodeSingle<IssueStatusRow>()
        if (current.status == "new" && current.assigned_dri == null) {
            postgrest.rpc("dri_self_assign", DriSelfAssignParams(p_issue_id = remoteId).toJsonParams())
        }

        postgrest.rpc("submit_dri_response", SubmitDriResponseParams(p_issue_id = remoteId, p_response = response.action, p_note = "Designation: ${response.designation}").toJsonParams())
        if (response.status == "Resolved") {
            postgrest.rpc("record_corrective_action", RecordCorrectiveActionParams(p_issue_id = remoteId, p_action_taken = response.action).toJsonParams())
        }

        insertGpsCapture(remoteId, "dri_response", response.gps.lat, response.gps.lng, response.gps.accuracyMeters, user.id)
        response.movPhotoPath?.let { uploadPhoto(remoteId, it, "mov", "dri_response", user.id) }
        response.selfiePhotoPath?.let { uploadPhoto(remoteId, it, "selfie", "dri_response", user.id) }
    }

    private suspend fun pushFinalVerification(issue: Issue, user: CurrentUser) {
        val remoteId = issue.remoteId ?: return
        val verification = issue.verification ?: return

        if (verification.confirmed) {
            postgrest.rpc("verify_and_close_issue", VerifyAndCloseIssueParams(p_issue_id = remoteId, p_note = verification.comment.ifBlank { null }).toJsonParams())
        } else {
            postgrest.rpc("reject_and_reopen_issue", RejectAndReopenIssueParams(p_issue_id = remoteId, p_comment = verification.comment).toJsonParams())
        }

        insertGpsCapture(remoteId, "verification", verification.gps.lat, verification.gps.lng, verification.gps.accuracyMeters, user.id)
        verification.selfiePhotoPath?.let { uploadPhoto(remoteId, it, "selfie", "verification", user.id) }
        verification.movPhotoPath?.let { uploadPhoto(remoteId, it, "mov", "verification", user.id) }
    }

    /** upsert, not insert — a sync retry after a partial failure (e.g. the GPS row lands but a
     *  later photo upload in the same push fails) must be able to re-run this step without
     *  hitting issue_gps_captures' unique(issue_id, stage) constraint on the second attempt. */
    private suspend fun insertGpsCapture(remoteIssueId: String, stage: String, lat: Double, lng: Double, accuracyMeters: Int, userId: String) {
        postgrest.from("issue_gps_captures").upsert(
            GpsCaptureInsertDto(issue_id = remoteIssueId, stage = stage, lat = lat, lng = lng, accuracy_m = accuracyMeters.toDouble(), captured_by = userId),
        ) { onConflict = "issue_id,stage" }
    }

    /** upsert, same reasoning as insertGpsCapture — see issue_photos_issue_id_stage_kind_key
     *  (migration 0022). Storage upload already used upsert=true so the file itself was never the
     *  problem, only the DB row could end up duplicated on a retry. */
    private suspend fun uploadPhoto(remoteIssueId: String, localPath: String, kind: String, stage: String, userId: String) {
        val file = File(localPath)
        if (!file.exists()) return
        val fileName = "${stage}_$kind.jpg"
        val storagePath = "$remoteIssueId/$fileName"
        storage.from(ISSUE_EVIDENCE_BUCKET).upload(storagePath, file.readBytes()) { upsert = true }
        postgrest.from("issue_photos").upsert(
            PhotoInsertDto(issue_id = remoteIssueId, storage_path = storagePath, file_name = fileName, mime_type = "image/jpeg", size_bytes = file.length(), uploaded_by = userId, kind = kind, stage = stage),
        ) { onConflict = "issue_id,stage,kind" }
    }

    private fun severityToPriority(severity: Severity): String = when (severity) {
        Severity.High -> "high"
        Severity.Medium -> "medium"
        Severity.Low -> "low"
    }

    private fun DriResponse.keepingLocalPhotos(local: DriResponse?): DriResponse =
        if (local == null) this else copy(
            movPhotoPath = local.movPhotoPath.takeIfLocalFile() ?: movPhotoPath,
            selfiePhotoPath = local.selfiePhotoPath.takeIfLocalFile() ?: selfiePhotoPath,
        )

    private fun Verification.keepingLocalPhotos(local: Verification?): Verification =
        if (local == null) this else copy(
            movPhotoPath = local.movPhotoPath.takeIfLocalFile() ?: movPhotoPath,
            selfiePhotoPath = local.selfiePhotoPath.takeIfLocalFile() ?: selfiePhotoPath,
        )

    private fun String?.takeIfLocalFile(): String? =
        this?.takeIf { EvidenceStorage.storagePathOf(it) == null && !it.startsWith("http") && File(it).exists() }

    private inline fun <reified T> T.toJsonParams(): JsonObject = Json.encodeToJsonElement(this).jsonObject

    private companion object {
        const val PULL_PAGE_SIZE = 300L
    }
}
