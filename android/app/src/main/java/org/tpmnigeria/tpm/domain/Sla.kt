package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Days from report to verified closure — the RUTF Finding target, the same as the web's
 * Accountability Scorecard and Findings Register (rutf_thresholds.finding_target_days, DECISIONS
 * R101). Replaces the TPM-era per-severity SLA (2 / 5 / 14 days).
 */
const val FINDING_TARGET_DAYS: Long = 30L

data class SlaState(
    val hasSla: Boolean,
    val overdue: Boolean,
    val label: String,
)

/**
 * due date = date reported + SLA_DAYS[severity]; overdue once elapsed. A closed issue has no
 * live SLA (mirrors the prototype's computeSla: `if (!issue.severity || status === 'Verified /
 * Closed') return { hasSla: false, ... }`).
 */
fun computeSla(issue: Issue, today: LocalDate = LocalDate.now()): SlaState {
    if (issue.status == IssueStatus.VerifiedClosed) {
        return SlaState(hasSla = false, overdue = false, label = "")
    }
    val dueDate = issue.dateReported.plusDays(FINDING_TARGET_DAYS)
    val diffDays = ChronoUnit.DAYS.between(today, dueDate)
    val overdue = diffDays < 0
    val label = if (overdue) "Past target by ${-diffDays}d" else "${diffDays}d to target"
    return SlaState(hasSla = true, overdue = overdue, label = label)
}
