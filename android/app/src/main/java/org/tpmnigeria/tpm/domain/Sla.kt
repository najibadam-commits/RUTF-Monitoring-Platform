package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** SLA-day thresholds per severity — README "Status & Severity System". */
val SLA_DAYS: Map<Severity, Long> = mapOf(
    Severity.High to 2L,
    Severity.Medium to 5L,
    Severity.Low to 14L,
)

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
    val dueDate = issue.dateReported.plusDays(SLA_DAYS.getValue(issue.severity))
    val diffDays = ChronoUnit.DAYS.between(today, dueDate)
    val overdue = diffDays < 0
    val label = if (overdue) "Overdue ${-diffDays}d" else "Due in ${diffDays}d"
    return SlaState(hasSla = true, overdue = overdue, label = label)
}
