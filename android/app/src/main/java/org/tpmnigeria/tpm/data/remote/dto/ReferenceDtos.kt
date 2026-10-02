package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class StateDto(val id: String, val code: String? = null, val name: String)

@Serializable
data class LgaDto(val id: String, val state_id: String, val name: String, val code: String? = null, val abbr: String? = null)

@Serializable
data class WardDto(val id: String, val lga_id: String, val name: String, val code: String? = null, val abbr: String? = null)

@Serializable
data class CategoryDto(val id: String, val name: String, val sort_order: Int = 0, val abbr: String? = null)

// Settlements and Activity Sites are independent siblings tied directly to
// a Ward (not a Settlement -> Activity Site chain) — see
// supabase/migrations/0019_ward_linked_settlements_activity_sites.sql and
// DECISIONS.md #8. statename/lganame are server-derived display columns,
// not used for filtering here (ward_id is the real join key).
@Serializable
data class SettlementDto(val id: String, val ward_id: String, val settlementname: String)

@Serializable
data class ActivitySiteDto(val id: String, val ward_id: String, val activitysitename: String)

/** `facilities` (web migration 0100) — only the columns the app caches. */
@Serializable
data class FacilityDto(
    val id: String,
    val name: String,
    val facility_type: String,
    val lga_id: String,
    val ward_id: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val is_otp_site: Boolean = false,
    val supplied_by_facility_id: String? = null,
)
