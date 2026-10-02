package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * Insert payload for a new `field_monitor_attendance` row — see
 * supabase/migrations/0037_field_monitor_attendance.sql. `state_id`/`lga_id`/`project_id` are
 * deliberately absent: the server's `resolve_attendance_location()` trigger fills all three
 * (state/LGA via the existing `resolve_administrative_location(lat,lng)` RPC, project_id from
 * the field monitor's own profile) — see DECISIONS.md #24 in the web project.
 */
@Serializable
data class AttendanceInsertDto(
    val field_monitor_id: String,
    val attendance_date: String,
    val captured_at: String,
    val lat: Double,
    val lng: Double,
    val gps_accuracy_m: Double,
    val selfie_storage_path: String,
    val assignment_location_storage_path: String,
    val device_id: String,
)

/** Decoded back after insert (`.select()` on the insert request) — only what this app needs. */
@Serializable
data class AttendanceRemoteDto(
    val id: String,
)
