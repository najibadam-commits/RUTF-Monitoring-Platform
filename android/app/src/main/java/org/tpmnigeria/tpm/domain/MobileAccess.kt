package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.UserRole

/**
 * What each role may DO in the mobile app. This is a UX mirror of the server's real permission
 * model, not the security boundary — every rule below matches an RLS policy or RPC guard in the
 * web project's supabase/migrations, and the server rejects the call regardless of what this app
 * shows (see DECISIONS.md #31 there). If a rule here disagrees with the server, the server wins
 * and the button just errors; change both together.
 *
 * Reading Findings is deliberately NOT a capability: every role that can sign in reads whatever
 * `issues_select` RLS returns for it (Super Admin: all; Project Admin: own project; State
 * Coordinator: own managed state; Field Monitor: own project; DRI: own assigned Findings), so the
 * local Room cache already contains exactly the right set with no client-side filtering.
 */
object MobileAccess {
    /** Register a new Finding — `issues_insert` RLS: super_admin, project_admin, tpm_supervisor
     *  (mirrors the web's canCreateIssue; State Coordinator is review-only). */
    fun canRegisterFinding(role: UserRole): Boolean =
        role == UserRole.FieldMonitor || role == UserRole.SuperAdmin || role == UserRole.ProjectAdmin

    /** Final Verification (verify & close / reject & reopen) — mirrors the web's canVerify. */
    fun canVerifyResolution(role: UserRole): Boolean =
        role == UserRole.FieldMonitor || role == UserRole.SuperAdmin || role == UserRole.ProjectAdmin

    /** DRI Response — the assigned DRI only. Super Admin can respond on the web as an admin
     *  override, but the mobile flow stamps the responder's own GPS/selfie/photos as the DRI's
     *  field evidence, which would misrepresent who was actually on site — so it stays DRI-only. */
    fun canRespondToFinding(role: UserRole): Boolean = role == UserRole.Dri

    /** Facility stock recording (receive / issue / dispense / count / loss) — web migration
     *  0101's record_* functions: the facility's own user (dri) only. Issue Stock additionally
     *  needs a store, Daily Dispensing an OTP site (checked against the facility). */
    fun canRecordStock(role: UserRole): Boolean = role == UserRole.Dri

    /** Supervision visits and adjustment confirmation — record_visit / confirm_adjustment
     *  (web migration 0103): supervisors, for the facilities in their LGAs at their level. */
    fun canSupervise(role: UserRole): Boolean = role == UserRole.FieldMonitor

    /** Senior roles use the app to oversee/support field work rather than to be the field
     *  worker — they get the oversight Home and see all in-scope Findings, not "my" Findings. */
    fun isOversightRole(role: UserRole): Boolean =
        role == UserRole.SuperAdmin || role == UserRole.ProjectAdmin || role == UserRole.StateCoordinator
}
