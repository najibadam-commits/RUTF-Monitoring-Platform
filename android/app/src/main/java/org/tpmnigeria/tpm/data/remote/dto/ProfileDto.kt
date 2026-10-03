package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

/** Matches the `profiles` table (supabase/migrations/0003_projects_profiles.sql) — only the
 *  columns this app actually reads. */
@Serializable
data class ProfileDto(
    val id: String,
    val name: String,
    val email: String,
    val role: String, // user_role enum: super_admin | project_admin | tpm_supervisor | dri | viewer
    val project_id: String? = null,
    val status: String, // account_status enum: active | inactive
    val facility_id: String? = null, // the facility a dri records for (web migration 0100)
    val supervision_level: String? = null, // supervisor: "stores" | "otp_sites" (web migration 0103)
)
