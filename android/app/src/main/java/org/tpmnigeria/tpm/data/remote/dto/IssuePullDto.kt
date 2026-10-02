package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * What the app actually reads back for the issue list/detail summary — embeds category/state/lga
 * display names via Postgrest's foreign-table select syntax (`categories(name)` etc.) so the UI
 * doesn't need N+1 lookups. See AppRepository.pullRemoteIssues / ReferenceRepository for the
 * known simplification this implies: an issue pulled from Supabase (created on the web, or on a
 * different device) shows this summary-level detail, not the full nested per-stage GPS/photo/
 * history detail a locally-originated issue has — hydrating that fully would mean joining
 * issue_history + issue_gps_captures + issue_photos too, which is a reasonable follow-up (an
 * on-demand "load full detail" fetch when opening Issue Detail for a remote-only issue) rather
 * than part of this bulk list pull.
 */
@Serializable
data class IssuePullDto(
    val id: String,
    val code: String,
    val mobile_code: String? = null,
    val description: String,
    val ward: String? = null,
    val settlement: String? = null,
    val settlement_id: String? = null,
    val activity_site: String? = null,
    val activity_site_id: String? = null,
    val location_other: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val reported_at: String,
    /** Server-maintained watermark (trigger-bumped on every UPDATE — see
     *  supabase/migrations/0007_functions_and_triggers.sql's issues_set_updated_at) that
     *  SupabaseSyncApiService.pullIssues uses for incremental/delta pulls. */
    val updated_at: String,
    val priority: String,
    val status: String,
    val assigned_dri: String? = null,
    val category_id: String,
    val state_id: String,
    val lga_id: String,
    val ward_id: String? = null,
    val dri_response: String? = null,
    val corrective_action: String? = null,
    val categories: NameOnly? = null,
    val states: NameOnly? = null,
    val lgas: NameOnly? = null,
    val issue_history: List<HistoryRemoteDto> = emptyList(),
    val issue_gps_captures: List<GpsCaptureRemoteDto> = emptyList(),
    val issue_photos: List<PhotoRemoteDto> = emptyList(),
)

@Serializable
data class NameOnly(val name: String)

/** Mirrors issue_history's real columns (action/occurred_at/actor_label) — see
 *  supabase/migrations/0007_functions_and_triggers.sql. actor_label is already a plain
 *  denormalized name column at insert time, not a joined profile name. */
@Serializable
data class HistoryRemoteDto(
    val action: String,
    val note: String? = null,
    val occurred_at: String,
    val actor_label: String,
)

@Serializable
data class GpsCaptureRemoteDto(
    val stage: String,
    val lat: Double,
    val lng: Double,
    val accuracy_m: Double? = null,
)

@Serializable
data class PhotoRemoteDto(
    val stage: String,
    val kind: String,
    val storage_path: String,
)
