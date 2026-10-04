package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.locationLabel
import org.tpmnigeria.tpm.domain.statusMeta
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.components.IssueRow
import org.tpmnigeria.tpm.ui.components.TpmTag
import org.tpmnigeria.tpm.ui.components.TpmTagVariant
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

private val STATUS_FILTERS = listOf("all", "overdue") + IssueStatus.entries.map { it.name }
private val SEVERITY_FILTERS = Severity.entries.map { it.name }

private fun filterLabel(value: String): String = when (value) {
    "all" -> "All"
    "overdue" -> "Past target"
    else -> runCatching { IssueStatus.valueOf(value).let { statusMeta(it).label } }
        .getOrElse { runCatching { value.lowercase().replaceFirstChar { c -> c.uppercase() } }.getOrDefault(value) }
}

private fun matches(issue: Issue, filter: String): Boolean = when (filter) {
    "all" -> true
    "overdue" -> computeSla(issue).overdue
    else -> runCatching { IssueStatus.valueOf(filter) }.getOrNull()?.let { issue.status == it }
        ?: runCatching { Severity.valueOf(filter) }.getOrNull()?.let { issue.severity == it }
        ?: true
}

/** README §3 Issue List: horizontal filter chips (status/severity/overdue — the design prototype
 *  only implements status+overdue; severity chips are an additive superset per the README's
 *  literal "status/severity/overdue filters" wording) + rows, tap → Issue Detail. */
@Composable
fun IssueListScreen(
    initialFilter: String?,
    onIssueClick: (String) -> Unit,
) {
    val repository = LocalAppRepository.current
    val issues by repository.observeIssues().collectAsState(initial = emptyList())
    var activeFilter by remember(initialFilter) { mutableStateOf(initialFilter ?: "all") }

    val filtered = remember(issues, activeFilter) { issues.filter { matches(it, activeFilter) } }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = TpmSpacing.space4, vertical = TpmSpacing.space2),
            horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
        ) {
            (STATUS_FILTERS + SEVERITY_FILTERS).forEach { value ->
                val selected = value == activeFilter
                TpmTag(
                    label = filterLabel(value),
                    variant = if (selected) TpmTagVariant.Accent else TpmTagVariant.Outline,
                    modifier = Modifier.clickable { activeFilter = value },
                )
            }
        }

        if (filtered.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "No findings in this filter yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.TextMuted,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = TpmSpacing.space4),
            ) {
                items(filtered, key = { it.id }) { issue ->
                    val sla = computeSla(issue)
                    val meta = statusMeta(issue.status)
                    IssueRow(
                        issueId = issue.id,
                        line2 = "${issue.category} · ${issue.locationLabel}",
                        line3 = issue.dateReported.toString(),
                        statusLabel = meta.label,
                        statusVariant = meta.variant,
                        overdue = sla.overdue,
                        onClick = { onIssueClick(issue.id) },
                    )
                }
            }
        }
    }
}
