package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.ui.components.TpmTagVariant

/**
 * Status → display label + tag variant, transcribed from the `statusMeta` function in
 * TPM Field App.dc.html (search `statusMeta`):
 *   New → outline, Ongoing → accent, Resolved — Pending Verification → accent ("Resolved · Pending"),
 *   Verified / Closed → neutral ("Verified"), Reopened → outline.
 */
data class StatusMeta(val label: String, val variant: TpmTagVariant)

fun statusMeta(status: IssueStatus): StatusMeta = when (status) {
    // RUTF stage names, the same as the web platform (DECISIONS R74, R101).
    IssueStatus.PendingReview -> StatusMeta("Awaiting review", TpmTagVariant.Outline)
    IssueStatus.ReturnedForCorrection -> StatusMeta("Returned", TpmTagVariant.Outline)
    IssueStatus.New -> StatusMeta("New", TpmTagVariant.Outline)
    IssueStatus.Ongoing -> StatusMeta("With the facility", TpmTagVariant.Accent)
    IssueStatus.ResolvedPendingVerification -> StatusMeta("Action recorded", TpmTagVariant.Accent)
    IssueStatus.VerifiedClosed -> StatusMeta("Verified & closed", TpmTagVariant.Neutral)
    IssueStatus.Reopened -> StatusMeta("Reopened", TpmTagVariant.Outline)
}

/** Full status name as used in filter chips / KPI labels (distinct from the compact tag label above). */
fun IssueStatus.displayName(): String = when (this) {
    // Not "Pending State Coordinator Review" — Project Admin and Super Admin can review/approve
    // too now (see DECISIONS.md #29 in the web project), so naming one specific role here would
    // be inaccurate.
    IssueStatus.PendingReview -> "Awaiting review"
    IssueStatus.ReturnedForCorrection -> "Returned to reporter"
    IssueStatus.New -> "New"
    IssueStatus.Ongoing -> "With the facility"
    IssueStatus.ResolvedPendingVerification -> "Action recorded, awaiting verification"
    IssueStatus.VerifiedClosed -> "Verified & closed"
    IssueStatus.Reopened -> "Reopened"
}
