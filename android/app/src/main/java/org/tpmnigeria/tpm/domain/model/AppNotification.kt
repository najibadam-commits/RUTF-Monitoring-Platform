package org.tpmnigeria.tpm.domain.model

/** Matches the README's Notifications screen: bell icon, title, body, relative time, unread dot. */
data class AppNotification(
    val id: Long,
    val role: UserRole,
    val issueId: String,
    val title: String,
    val body: String,
    val timestampMillis: Long,
    val unread: Boolean,
)

/**
 * The platform's own roles (`profiles.role`, see the web project's rbac.ts) as this app knows
 * them — one enum per real role, not a mobile-specific rename. [dbValue] is the exact
 * `user_role` enum string; [label] matches the web's ROLE_LABELS. `viewer` is intentionally
 * absent: it has no mobile access (see [fromDbValue]).
 *
 * The enum *names* are also what AppSession caches and Room's NotificationEntity stores, so
 * renaming one is a data migration — add new roles, don't rename existing ones.
 */
enum class UserRole(val dbValue: String, val label: String) {
    FieldMonitor("tpm_supervisor", "Supervisor"),
    Dri("dri", "OTP / Nutrition Officer"),
    SuperAdmin("super_admin", "Super Admin"),
    ProjectAdmin("project_admin", "Project Admin"),
    StateCoordinator("state_coordinator", "State Coordinator");

    companion object {
        /** Null for any role without mobile access (currently `viewer`, plus anything unknown). */
        fun fromDbValue(dbValue: String): UserRole? = entries.firstOrNull { it.dbValue == dbValue }
    }
}
