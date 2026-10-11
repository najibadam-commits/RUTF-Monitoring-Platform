package org.tpmnigeria.tpm.ui.stock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.relativeTimeString
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.time.LocalDate
import java.time.temporal.ChronoUnit

private const val EXPIRY_WARN_DAYS = 90L

/**
 * My Stock (brief §8): balance by lot with expiry warnings, transfers on their way, entries still
 * waiting to sync, and open Findings — from the offline cache plus the sync queue.
 */
@Composable
fun MyStockScreen(facilityId: String) {
    val stock = LocalStockRepository.current
    val references = LocalReferenceRepository.current
    val repository = LocalAppRepository.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val facility by remember(facilityId) { references.observeFacility(facilityId) }.collectAsState(initial = null)
    val position by remember(facilityId) { stock.observeStock(facilityId) }.collectAsState(initial = null)
    val refreshedAt by remember(facilityId) { stock.observeRefreshedAt(facilityId) }.collectAsState(initial = null)
    val transfers by remember(facilityId) { stock.observeIncomingTransfers(facilityId) }.collectAsState(initial = emptyList())
    val u by stock.observeUnitsPerCarton().collectAsState(initial = StockRepository.DEFAULT_UNITS_PER_CARTON)
    val issues by repository.observeIssues().collectAsState(initial = emptyList())
    val openFindings = issues.count { it.status != IssueStatus.VerifiedClosed }
    val names = rememberFacilityNames(references, transfers.map { it.fromFacilityId })
    var refreshing by remember { mutableStateOf(false) }
    val today = LocalDate.now()

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
    ) {
        item {
            Text(facility?.name ?: "My stock", style = MaterialTheme.typography.headlineSmall)
            Text(
                refreshedAt?.let { "Ledger as of ${relativeTimeString(it)}" } ?: "Not downloaded yet — connect and refresh.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted,
            )
        }
        item {
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                val p = position
                Text("On hand", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                Text(p?.let { "${fmt(it.total)} sachets" } ?: "—", style = MaterialTheme.typography.headlineMedium,
                    color = if ((p?.total ?: 1) <= 0) TpmColors.Error else MaterialTheme.colorScheme.onSurface)
                p?.let { Text("${fmt(maxOf(0, it.total) / u)} cartons", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
                if ((p?.pendingSubmissions ?: 0) > 0) {
                    Text("Includes ${p!!.pendingSubmissions} entr${if (p.pendingSubmissions == 1) "y" else "ies"} waiting to sync" +
                        if (p.pendingDispensed > 0) " (${fmt(p.pendingDispensed)} sachets dispensed, lot assigned on sync)." else ".",
                        style = MaterialTheme.typography.bodySmall, color = TpmColors.Warning)
                }
            }
        }
        val lots = position?.lots.orEmpty().filter { it.projected != 0 || it.lotId != null }
        if (lots.isNotEmpty()) item { Text("By lot", style = MaterialTheme.typography.titleMedium) }
        items(lots, key = { it.lotKey }) { lot ->
            val days = lot.expiryDate?.let { ChronoUnit.DAYS.between(today, LocalDate.parse(it)) }
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                Text(lotLabel(lot.lotNo, null), style = MaterialTheme.typography.titleSmall)
                Text("${fmt(lot.projected)} sachets" + if (lot.pending != 0) " (${"%+,d".format(lot.pending)} not yet synced)" else "",
                    style = MaterialTheme.typography.bodyMedium)
                if (days != null) {
                    Text(
                        when {
                            days < 0 && lot.projected > 0 -> "Expired ${lot.expiryDate} — record it as an expired loss."
                            days < 0 -> "Expired ${lot.expiryDate}"
                            days <= EXPIRY_WARN_DAYS -> "Expires ${lot.expiryDate} — in $days days. Use first."
                            else -> "Expires ${lot.expiryDate}"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (days <= EXPIRY_WARN_DAYS && lot.projected > 0) TpmColors.Warning else TpmColors.TextMuted,
                    )
                }
            }
        }
        item { Text("On the way", style = MaterialTheme.typography.titleMedium) }
        if (transfers.isEmpty()) item { Text("No transfers in transit to this facility.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
        items(transfers, key = { it.id }) { t ->
            val age = ChronoUnit.DAYS.between(LocalDate.parse(t.issuedDate), today)
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                Text("${t.code ?: "Transfer"} · ${fmt(t.sachetsIssued)} sachets", style = MaterialTheme.typography.titleSmall)
                Text("From ${names[t.fromFacilityId] ?: "your supplying store"} · issued ${t.issuedDate} ($age day${if (age == 1L) "" else "s"} ago)",
                    style = MaterialTheme.typography.bodySmall, color = if (age > 7) TpmColors.Warning else TpmColors.TextMuted)
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                Text("Open Findings: $openFindings", style = MaterialTheme.typography.bodyMedium)
                TpmButton(
                    text = if (refreshing) "Refreshing…" else "Refresh from server",
                    icon = Icons.Filled.Refresh,
                    variant = TpmButtonVariant.Secondary,
                    enabled = !refreshing,
                    fullWidth = true,
                    onClick = {
                        scope.launch {
                            refreshing = true
                            val ok = runCatching { references.refreshFacilities(); stock.refresh(facilityId) }.isSuccess
                            refreshing = false
                            toast.show(if (ok) "Stock refreshed." else "Couldn't reach the server — showing the last downloaded stock.")
                        }
                    },
                )
            }
        }
    }
}
