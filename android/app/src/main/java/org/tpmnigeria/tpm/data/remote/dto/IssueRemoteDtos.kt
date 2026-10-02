package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

/** Insert payload for a new `issues` row — see supabase/migrations/0004_issues.sql, 0016, 0019. */
@Serializable
data class IssueInsertDto(
    val category_id: String,
    val description: String,
    val state_id: String,
    val lga_id: String,
    val ward_id: String? = null,
    val ward: String? = null,
    val settlement_id: String? = null,
    val settlement: String? = null,
    val activity_site_id: String? = null,
    val activity_site: String? = null,
    val location_other: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val priority: String,
    val project_id: String? = null,
    val reported_by: String,
    val mobile_code: String,
)

/** Decoded back after insert (`.select()` on the insert request) — only what this app needs. */
@Serializable
data class IssueRemoteDto(
    val id: String,
    val code: String,
    val status: String,
    val assigned_dri: String? = null,
)

@Serializable
data class GpsCaptureInsertDto(
    val issue_id: String,
    val stage: String, // "discovery" | "dri_response" | "verification"
    val lat: Double,
    val lng: Double,
    val accuracy_m: Double?,
    val captured_by: String,
)

@Serializable
data class PhotoInsertDto(
    val issue_id: String,
    val storage_path: String,
    val file_name: String? = null,
    val mime_type: String? = null,
    val size_bytes: Long? = null,
    val uploaded_by: String,
    val kind: String, // "mov" | "selfie"
    val stage: String, // "discovery" | "dri_response" | "verification"
)

// ---- RPC parameter shapes (must match each function's p_-prefixed argument names exactly) ----

@Serializable
data class DriSelfAssignParams(val p_issue_id: String)

@Serializable
data class SubmitDriResponseParams(val p_issue_id: String, val p_response: String, val p_note: String? = null)

@Serializable
data class RecordCorrectiveActionParams(val p_issue_id: String, val p_action_taken: String, val p_note: String? = null)

@Serializable
data class VerifyAndCloseIssueParams(val p_issue_id: String, val p_note: String? = null)

@Serializable
data class RejectAndReopenIssueParams(val p_issue_id: String, val p_comment: String)

@Serializable
data class IssueStatusRow(val status: String, val assigned_dri: String? = null)

/** Single-column shape for the full RLS-scoped id sweep — see SupabaseSyncApiService.pullIssues'
 *  reconciliation pass / DECISIONS.md #27. */
@Serializable
data class IssueIdDto(val id: String)
