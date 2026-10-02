package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.data.remote.EvidenceStorage
import org.tpmnigeria.tpm.data.remote.dto.IssuePullDto
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.Verification

/**
 * issue_status (8 values: pending_review/returned_for_correction/new/assigned/in_progress/
 * resolved/verified_closed/reopened) collapses onto the mobile app's 7-value IssueStatus —
 * `assigned` and `in_progress` both read as Ongoing. The distinction is a server-side
 * implementation detail of the assign→respond RPC split (see DECISIONS.md #7 in the web
 * project); the mobile wizard flow never produces a bare `assigned` state itself
 * (dri_self_assign and submit_dri_response are pushed together in one queued submission — see
 * SupabaseSyncApiService.pushDriResponse), so this mapping only matters for *reading back* an
 * issue a TPM Supervisor assigned from the web app but no DRI has acted on yet.
 *
 * pending_review/returned_for_correction map to their own distinct local states (added for the
 * State Coordinator workflow, DECISIONS.md #22) rather than collapsing into New — a Field
 * Monitor's own just-submitted Finding should read as "Pending Review", not "New", the moment it
 * exists, matching what the server already considers it to be.
 */
fun remoteStatusToIssueStatus(remoteStatus: String): IssueStatus = when (remoteStatus) {
    "pending_review" -> IssueStatus.PendingReview
    "returned_for_correction" -> IssueStatus.ReturnedForCorrection
    "new" -> IssueStatus.New
    "assigned", "in_progress" -> IssueStatus.Ongoing
    "resolved" -> IssueStatus.ResolvedPendingVerification
    "verified_closed" -> IssueStatus.VerifiedClosed
    "reopened" -> IssueStatus.Reopened
    else -> IssueStatus.PendingReview
}

/** issue_priority has 4 values; the mobile app's Severity has 3 (no Critical — see
 *  DECISIONS.md #7 "severity → priority mapping"). Reading a web-created `critical` issue back
 *  displays it as High — the closest and most conservative fallback (never silently downgrades
 *  a critical issue's visible urgency to Medium/Low). */
fun priorityToSeverity(priority: String): Severity = when (priority) {
    "critical", "high" -> Severity.High
    "medium" -> Severity.Medium
    "low" -> Severity.Low
    else -> Severity.Medium
}

/**
 * The Final Verification outcome as recorded on the server — verification-stage photos + GPS,
 * plus the verifier's outcome and note from the newest "Verified and closed" / "Final Verification
 * — Not Resolved" history event — so anyone opening a Finding sees it, not only the device that
 * submitted it. Null when nothing verification-related exists yet. The list pull doesn't embed
 * history/GPS/photos, so this only fills in on the detail refresh (pullIssueDetail), like the DRI
 * response. [status] is the already-mapped local status, used as the outcome when there is a photo
 * or GPS fix but no history event to say which way it went.
 */
fun IssuePullDto.toVerification(status: IssueStatus): Verification? {
    val gps = issue_gps_captures.find { it.stage == "verification" }
    val photos = issue_photos.filter { it.stage == "verification" }
    val event = issue_history
        .filter { it.action == "Verified and closed" || it.action == "Final Verification — Not Resolved" }
        .maxByOrNull { it.occurred_at }
    if (gps == null && photos.isEmpty() && event == null) return null
    fun photo(kind: String) = photos.find { it.kind == kind }?.storage_path?.let { EvidenceStorage.reference(it) }
    return Verification(
        confirmed = event?.let { it.action == "Verified and closed" } ?: (status == IssueStatus.VerifiedClosed),
        comment = event?.note.orEmpty(),
        date = (event?.occurred_at ?: reported_at).take(10),
        gps = GpsCapture(gps?.lat ?: lat ?: 0.0, gps?.lng ?: lng ?: 0.0, gps?.accuracy_m?.toInt() ?: 0),
        selfiePhotoPath = photo("selfie"),
        movPhotoPath = photo("mov"),
    )
}
