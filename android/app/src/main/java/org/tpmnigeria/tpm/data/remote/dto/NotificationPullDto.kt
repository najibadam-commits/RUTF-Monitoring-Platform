package org.tpmnigeria.tpm.data.remote.dto

import kotlinx.serialization.Serializable

/** Matches the `notifications` table — see supabase/migrations/0006_notifications_and_settings.sql. */
@Serializable
data class NotificationPullDto(
    val id: String,
    val type: String,
    val text: String,
    val issue_id: String? = null,
    val read: Boolean,
    val created_at: String,
)
