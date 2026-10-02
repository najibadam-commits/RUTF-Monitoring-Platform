package org.tpmnigeria.tpm.domain.model

import kotlinx.serialization.Serializable
import java.time.LocalDate

/**
 * Core domain model — mirrors the `issue` shape described in the README's "State & Data Notes"
 * section (id, location fields, category, severity, description, reporter, dateReported,
 * gpsIssue, status, driResponse, verification, history[]), extended to carry the real Supabase
 * schema's identifiers alongside — see DECISIONS.md #7 in the web project ("two issue-ID schemes,
 * on purpose").
 *
 * [id] is the client-generated, immediately-visible offline-first code — `KMC-NAS-WSF-26-NI001`
 * style, restyled (see IssueIdGenerator) to match the web's structured convention below, though
 * it's computed completely independently and will never equal [remoteCode] for the same issue;
 * matches `issues.mobile_code` server-side — and remains the Room primary key and what every
 * screen displays. [remoteId] (`issues.id`, a uuid) and [remoteCode] (`issues.code`, structured
 * `KMC-NAS-ROA-26-NI001` style as of web migration 0026 — pre-migration rows keep their old
 * `ISS-1042` style) are null until this issue has actually synced — any action that needs to
 * reference the row server-side (DRI self-assign, responses, verification) requires [remoteId]
 * to be non-null first, which is why the sync queue must process a device's submissions in the
 * order they were created (see SyncQueueDao).
 */
data class Issue(
    val id: String,
    val remoteId: String? = null,
    val remoteCode: String? = null,
    val state: String,
    val stateId: String? = null,
    val lga: String,
    val lgaId: String? = null,
    val ward: String,
    val wardId: String? = null,
    val settlement: String,
    val settlementId: String? = null,
    val site: String,
    val siteId: String? = null,
    /** Free-text location typed by the field enumerator when the real place wasn't in the
     *  preloaded Settlement/Activity Site list for the Ward (see NewIssueWizard "Other" option).
     *  Only ever non-null when both [settlementId] and [siteId] are null — see
     *  supabase/migrations/0020_issue_location_other.sql. */
    val locationOther: String? = null,
    val category: String,
    val categoryId: String? = null,
    val severity: Severity,
    val description: String,
    val reporter: String,
    val dateReported: LocalDate,
    val gpsIssue: GpsCapture,
    val status: IssueStatus,
    val assignedDriId: String? = null,
    /** MOV/selfie captured at registration time — README §5 "MOV Photo"/"Selfie" steps. Real
     *  file paths (app-private external storage), unlike the design prototype which only tracked
     *  a captured boolean — see README §4 "swap for the actual captured photos in the native build". */
    val movPhotoPath: String? = null,
    val selfiePhotoPath: String? = null,
    val driResponse: DriResponse? = null,
    val verification: Verification? = null,
    val history: List<HistoryEvent> = emptyList(),
)

@Serializable
data class GpsCapture(
    val lat: Double,
    val lng: Double,
    val accuracyMeters: Int,
)

@Serializable
data class DriResponse(
    val name: String,
    val designation: String,
    val action: String,
    val date: String, // ISO yyyy-MM-dd
    val gps: GpsCapture,
    val status: String, // "Ongoing" | "Resolved" — the DRI's chosen status for this response
    val movPhotoPath: String? = null,
    val selfiePhotoPath: String? = null,
)

@Serializable
data class Verification(
    val confirmed: Boolean,
    val comment: String,
    val date: String, // ISO yyyy-MM-dd
    val gps: GpsCapture,
    /** Selfie is required (confirms verifier's presence); MOV photo of the resolved condition is optional. */
    val selfiePhotoPath: String? = null,
    val movPhotoPath: String? = null,
)

@Serializable
data class HistoryEvent(
    val event: String,
    val user: String,
    val date: String, // ISO yyyy-MM-dd
    val time: String, // HH:mm
    val location: String,
)

/**
 * Display label for wherever the UI shows "the location" in one string (list rows, detail
 * headers). [Issue.site]/[Issue.settlement] are `""` rather than null when not applicable (see
 * [Issue.locationOther]) — this picks whichever of the three was actually captured, in the same
 * precedence AppRepository.submitNewIssue and SupabaseSyncApiService use for issue history/list
 * labels: Activity Site, then Settlement, then the manually-typed "Other" text.
 */
val Issue.locationLabel: String
    get() = site.ifBlank { settlement }.ifBlank { locationOther.orEmpty() }

enum class Severity { High, Medium, Low }

/**
 * Pending Review (State Coordinator) → New/Returned for Correction → Ongoing → Resolved – Pending
 * Verification → Verified / Closed, or → Reopened → back to Ongoing (routed to the original DRI).
 * See README "Status & Severity System" and DECISIONS.md #22 (State Coordinator workflow) in the
 * web project. PendingReview/ReturnedForCorrection are web-only states to *act on* (only a State
 * Coordinator reviews/approves — no mobile UI for that role, same pattern as every other
 * web-only role) — the mobile app only ever needs to *display* them correctly for a Field
 * Monitor looking at their own just-submitted Finding.
 */
enum class IssueStatus {
    PendingReview,
    ReturnedForCorrection,
    New,
    Ongoing,
    ResolvedPendingVerification,
    VerifiedClosed,
    Reopened,
}
