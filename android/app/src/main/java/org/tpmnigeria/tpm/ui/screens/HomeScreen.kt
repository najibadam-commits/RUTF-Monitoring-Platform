package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import org.tpmnigeria.tpm.domain.MobileAccess
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.UserRole
import org.tpmnigeria.tpm.domain.model.locationLabel
import org.tpmnigeria.tpm.domain.statusMeta
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.components.IssueRow
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

private data class Kpi(val label: String, val count: Int, val filter: String?, val toSyncQueue: Boolean = false)

/** README §2 Home. KPI grid + role CTA + Recent Issues, matching the prototype's per-role KPI
 *  set (search `const kpis` in TPM Field App.dc.html). Filter values passed to
 *  onNavigateToIssueList are IssueStatus enum names, or the special values "all"/"overdue" —
 *  see IssueListScreen's filter parsing. */
@Composable
fun HomeScreen(
    onNavigateToIssueList: (filter: String?) -> Unit,
    onIssueClick: (String) -> Unit,
    onStartNewIssue: () -> Unit,
    onStartDriLookup: () -> Unit,
    onStartAttendance: () -> Unit,
    onNavigateToSyncQueue: () -> Unit,
    onLogout: () -> Unit,
) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val user = session.currentUser.collectAsState().value ?: return
    val issues by repository.observeIssues().collectAsState(initial = emptyList())
    val pendingSync by repository.observePendingSyncCount().collectAsState(initial = 0)

    val role = user.role
    val kpis = remember(issues, pendingSync, role) { buildKpis(issues, pendingSync, role) }
    val recent = issues.take(3)

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
            ) {
                Column {
                    Text("Good day,", style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
                    Text(user.name, style = MaterialTheme.typography.headlineMedium)
                }
                TpmButton(
                    text = "Sign Out",
                    onClick = onLogout,
                    variant = TpmButtonVariant.Ghost,
                )
            }
            Spacer(Modifier.height(TpmSpacing.space3))
            // Each action shows only for a role the server would actually let perform it — see
            // MobileAccess. A role with none of these (State Coordinator) gets a pure oversight Home.
            var anyAction = false
            if (MobileAccess.canRegisterFinding(role)) {
                anyAction = true
                TpmButton(
                    text = "Register New Finding",
                    icon = Icons.Filled.Add,
                    onClick = onStartNewIssue,
                    blueprint = true,
                    fullWidth = true,
                )
                Spacer(Modifier.height(TpmSpacing.space2))
            }
            if (MobileAccess.canCaptureAttendance(role)) {
                anyAction = true
                TpmButton(
                    text = "Daily Attendance",
                    icon = Icons.Filled.CalendarMonth,
                    onClick = onStartAttendance,
                    variant = TpmButtonVariant.Secondary,
                    blueprint = true,
                    fullWidth = true,
                )
                Spacer(Modifier.height(TpmSpacing.space2))
            }
            if (MobileAccess.canRespondToFinding(role)) {
                anyAction = true
                TpmButton(
                    text = "Look Up Finding ID",
                    icon = Icons.Filled.Search,
                    onClick = onStartDriLookup,
                    blueprint = true,
                    fullWidth = true,
                )
            }
            if (anyAction) Spacer(Modifier.height(TpmSpacing.space2))
            Spacer(Modifier.height(TpmSpacing.space2))
        }

        items(kpis.chunked(2)) { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2), modifier = Modifier.fillMaxWidth()) {
                pair.forEach { kpi ->
                    TpmCard(
                        modifier = Modifier
                            .weight(1f)
                            .clickable { if (kpi.toSyncQueue) onNavigateToSyncQueue() else onNavigateToIssueList(kpi.filter) },
                    ) {
                        Text(kpi.count.toString(), style = MaterialTheme.typography.headlineSmall)
                        Text(kpi.label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }

        item {
            Spacer(Modifier.height(TpmSpacing.space4))
            Text("Recent Findings", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        }

        if (recent.isEmpty()) {
            item {
                Text(
                    "No findings yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.TextMuted,
                    modifier = Modifier.padding(vertical = TpmSpacing.space4),
                )
            }
        } else {
            items(recent) { issue ->
                val sla = computeSla(issue)
                val meta = statusMeta(issue.status)
                IssueRow(
                    issueId = issue.id,
                    line2 = "${issue.locationLabel} · ${issue.dateReported}",
                    statusLabel = meta.label,
                    statusVariant = meta.variant,
                    overdue = sla.overdue,
                    onClick = { onIssueClick(issue.id) },
                )
            }
        }
    }
}

private fun buildKpis(issues: List<Issue>, pendingSync: Int, role: UserRole): List<Kpi> {
    fun count(predicate: (Issue) -> Boolean) = issues.count(predicate)
    val overdueCount = issues.count { computeSla(it).overdue }
    if (MobileAccess.isOversightRole(role)) {
        // Whole-picture counts across everything this account can see (RLS-scoped: all Findings
        // for Super Admin, own project for Project Admin, own state for State Coordinator).
        // Pending Sync only appears for a role that can queue writes at all.
        val canQueueWrites = MobileAccess.canRegisterFinding(role) || MobileAccess.canVerifyResolution(role)
        return listOfNotNull(
            Kpi("Total Findings", issues.size, "all"),
            Kpi("Pending Review", count { it.status == IssueStatus.PendingReview }, IssueStatus.PendingReview.name),
            Kpi("Ongoing", count { it.status == IssueStatus.Ongoing }, IssueStatus.Ongoing.name),
            Kpi("Resolved — Awaiting Verification", count { it.status == IssueStatus.ResolvedPendingVerification }, IssueStatus.ResolvedPendingVerification.name),
            Kpi("Verified / Closed", count { it.status == IssueStatus.VerifiedClosed }, IssueStatus.VerifiedClosed.name),
            Kpi("Reopened", count { it.status == IssueStatus.Reopened }, IssueStatus.Reopened.name),
            Kpi("Overdue (SLA)", overdueCount, "overdue"),
            if (canQueueWrites) Kpi("Pending Sync", pendingSync, null, toSyncQueue = true) else null,
        )
    }
    return if (role == UserRole.FieldMonitor) {
        listOf(
            Kpi("Registered", issues.size, "all"),
            Kpi("Ongoing", count { it.status == IssueStatus.Ongoing }, IssueStatus.Ongoing.name),
            Kpi("Resolved — Awaiting Verification", count { it.status == IssueStatus.ResolvedPendingVerification }, IssueStatus.ResolvedPendingVerification.name),
            Kpi("Verified / Closed", count { it.status == IssueStatus.VerifiedClosed }, IssueStatus.VerifiedClosed.name),
            Kpi("Reopened", count { it.status == IssueStatus.Reopened }, IssueStatus.Reopened.name),
            Kpi("Overdue (SLA)", overdueCount, "overdue"),
            Kpi("Pending Sync", pendingSync, null, toSyncQueue = true),
        )
    } else {
        listOf(
            Kpi("Assigned", count { it.status != IssueStatus.VerifiedClosed }, "all"),
            Kpi("New Assignments", count { it.status == IssueStatus.New }, IssueStatus.New.name),
            Kpi("Ongoing", count { it.status == IssueStatus.Ongoing }, IssueStatus.Ongoing.name),
            Kpi("Resolved", count { it.status == IssueStatus.ResolvedPendingVerification }, IssueStatus.ResolvedPendingVerification.name),
            Kpi("Returned for Action", count { it.status == IssueStatus.Reopened }, IssueStatus.Reopened.name),
            Kpi("Overdue (SLA)", overdueCount, "overdue"),
            Kpi("Pending Sync", pendingSync, null, toSyncQueue = true),
        )
    }
}
