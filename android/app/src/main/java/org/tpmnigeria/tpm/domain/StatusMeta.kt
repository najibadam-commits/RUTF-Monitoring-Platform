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
    IssueStatus.PendingReview -> StatusMeta("Pending Review", TpmTagVariant.Outline)
    IssueStatus.ReturnedForCorrection -> StatusMeta("Returned", TpmTagVariant.Outline)
    IssueStatus.New -> StatusMeta("New", TpmTagVariant.Outline)
    IssueStatus.Ongoing -> StatusMeta("Ongoing", TpmTagVariant.Accent)
    IssueStatus.ResolvedPendingVerification -> StatusMeta("Resolved · Pending", TpmTagVariant.Accent)
    IssueStatus.VerifiedClosed -> StatusMeta("Verified", TpmTagVariant.Neutral)
    IssueStatus.Reopened -> StatusMeta("Reopened", TpmTagVariant.Outline)
}

/** Full status name as used in filter chips / KPI labels (distinct from the compact tag label above). */
fun IssueStatus.displayName(): String = when (this) {
    // Not "Pending State Coordinator Review" — Project Admin and Super Admin can review/approve
    // too now (see DECISIONS.md #29 in the web project), so naming one specific role here would
    // be inaccurate.
    IssueStatus.PendingReview -> "Pending Review"
    IssueStatus.ReturnedForCorrection -> "Returned for Correction"
    IssueStatus.New -> "New"
    IssueStatus.Ongoing -> "Ongoing"
    IssueStatus.ResolvedPendingVerification -> "Resolved — Pending Verification"
    IssueStatus.VerifiedClosed -> "Verified / Closed"
    IssueStatus.Reopened -> "Reopened"
}
