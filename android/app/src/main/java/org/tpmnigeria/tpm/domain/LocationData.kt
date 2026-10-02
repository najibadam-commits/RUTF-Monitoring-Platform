package org.tpmnigeria.tpm.domain

/**
 * State/LGA/Ward/Category pick-lists now come from the real Supabase tables via
 * ReferenceRepository (cached in Room for offline use) — see ui/wizard/newissue's
 * LocationStep/IssueDetailsStep. The hardcoded 3-state sample data this file used to hold is
 * gone; that was always seed/sample data per the original design README, superseded once this
 * app was wired to the real backend (see DECISIONS.md #7 in the web project).
 *
 * DESIGNATION_OPTIONS has no backing table in the real schema at all — `issues` has no
 * designation column (see supabase/migrations/0004_issues.sql). It's folded into the audit-trail
 * note passed to submit_dri_response rather than a first-class field — see
 * DriRespondWizardViewModel.
 */
val DESIGNATION_OPTIONS = listOf(
    "LGA Desk Officer",
    "M&E Officer",
    "Program Officer",
    "State Coordinator",
)
