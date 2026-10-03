package org.tpmnigeria.tpm.ui.stock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.time.LocalDate
import java.util.UUID

/**
 * Confirm adjustments (brief §8): adjustments the facilities a supervisor covers recorded — count
 * differences, corrections — wait for the supervisor's confirmation (DECISIONS R7). Confirming
 * queues confirm_adjustment (web migration 0103) through the sync queue, so it works offline.
 */
@Composable
fun ConfirmAdjustmentsScreen() {
    val stock = LocalStockRepository.current
    val references = LocalReferenceRepository.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val pending by stock.observePendingAdjustments().collectAsState(initial = emptyList())
    val lots by stock.observeLots().collectAsState(initial = emptyList())
    val names = rememberFacilityNames(references, pending.map { it.facilityId })
    val notes = remember { mutableStateMapOf<String, String>() }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
    ) {
        item {
            Text("Adjustments to confirm", style = MaterialTheme.typography.headlineSmall)
            Text("Check each one with the facility (stock card, recount) before confirming.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }
        if (pending.isEmpty()) item {
            Text("Nothing waiting for confirmation (as of the last sync).", style = MaterialTheme.typography.bodyMedium)
        }
        items(pending, key = { it.id }) { a ->
            val lot = lots.firstOrNull { it.id == a.lotId }
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                Text(names[a.facilityId] ?: "Facility", style = MaterialTheme.typography.titleSmall)
                Text("${"%+,d".format(a.quantity)} sachets · ${lotLabel(lot?.lotNo, lot?.expiryDate)} · ${a.txnDate}", style = MaterialTheme.typography.bodyMedium)
                a.reason?.let { Text("Reason: $it", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
                TpmTextField(label = "Your note (optional)", value = notes[a.id].orEmpty(), onValueChange = { notes[a.id] = it })
                TpmButton(
                    text = "Confirm adjustment",
                    fullWidth = true,
                    onClick = {
                        scope.launch {
                            stock.submit(
                                LedgerSubmissions.confirmAdjustment(
                                    localId = UUID.randomUUID().toString(), facilityId = a.facilityId, adjustmentId = a.id,
                                    note = notes[a.id], date = LocalDate.now().toString(),
                                    summary = "Confirmed ${"%+,d".format(a.quantity)} sachets at ${names[a.facilityId] ?: "a facility"}",
                                ),
                            )
                            toast.show("Confirmed — it will sync when you're online.")
                        }
                    },
                )
            }
        }
    }
}
