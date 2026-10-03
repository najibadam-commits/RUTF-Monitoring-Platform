package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.AppRepository.Companion.MAX_SYNC_RETRIES
import org.tpmnigeria.tpm.domain.model.SyncStatus
import org.tpmnigeria.tpm.domain.relativeTimeString
import org.tpmnigeria.tpm.sync.SyncScheduler
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTag
import org.tpmnigeria.tpm.ui.components.TpmTagVariant
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/** README §10 Sync Queue: offline-first info card + Sync Now, one row per queued submission,
 *  empty state "Nothing queued — everything is synced." "Sync Now" enqueues a real WorkManager
 *  run (SyncScheduler) rather than faking success. */
@Composable
fun SyncQueueScreen() {
    val repository = LocalAppRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val queue by repository.observeSyncQueue().collectAsState(initial = emptyList())

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
    ) {
        item {
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Offline-first: submissions save to this device first and sync automatically when a connection is available.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(TpmSpacing.space2))
                TpmButton(
                    text = "Sync Now",
                    icon = Icons.Filled.Cloud,
                    onClick = { 
                        SyncScheduler.syncNow(context)
                        toast.show("Attempting to sync...")
                    },
                    blueprint = true,
                    fullWidth = true,
                )
            }
            Spacer(Modifier.height(TpmSpacing.space2))
        }

        if (queue.isEmpty()) {
            item {
                Box(modifier = Modifier.fillMaxWidth().padding(vertical = TpmSpacing.space8), contentAlignment = Alignment.Center) {
                    Text("Nothing queued — everything is synced.", color = TpmColors.TextMuted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else {
            items(queue, key = { it.localId }) { item ->
                TpmCard(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column {
                            Text(item.issueId, style = MaterialTheme.typography.titleMedium)
                            Text(
                                "${submissionTypeLabel(item.submissionType.name)} · ${relativeTimeString(item.timestampMillis)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = TpmColors.TextMuted,
                            )
                        }
                        val (label, variant) = when (item.status) {
                            SyncStatus.Synced -> "Synced" to TpmTagVariant.Neutral
                            SyncStatus.Failed -> "Failed" to TpmTagVariant.Outline
                            SyncStatus.Pending -> "Pending" to TpmTagVariant.Accent
                        }
                        TpmTag(label, variant)
                    }
                    if (item.status == SyncStatus.Failed) {
                        Spacer(Modifier.height(TpmSpacing.space2))
                        Text(
                            "Didn't go through after $MAX_SYNC_RETRIES attempts.",
                            style = MaterialTheme.typography.bodySmall,
                            color = TpmColors.TextMuted,
                        )
                        Spacer(Modifier.height(TpmSpacing.space2))
                        TpmButton(
                            text = "Retry",
                            variant = TpmButtonVariant.Secondary,
                            onClick = {
                                scope.launch {
                                    repository.retrySyncItem(item.localId)
                                    SyncScheduler.syncNow(context)
                                    toast.show("Retrying…")
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

private fun submissionTypeLabel(name: String): String = when (name) {
    "NewIssue" -> "New Finding"
    "DriResponse" -> "DRI Response"
    "FinalVerification" -> "Final Verification"
    "StockReceipt" -> "Receive Stock"
    "StockIssue" -> "Issue Stock"
    "Dispensing" -> "Daily Dispensing"
    "StockCount" -> "Stock Count"
    "StockLoss" -> "Loss / Adjustment"
    "StoreCheck" -> "Store Check"
    "OtpVerification" -> "OTP Verification"
    "AdjustmentConfirmation" -> "Adjustment confirmed"
    else -> name
}
