package org.tpmnigeria.tpm.ui.components

import org.tpmnigeria.tpm.ui.theme.TpmRadius
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors

/**
 * Banner shown above the content area whenever there are pending sync items — README §10:
 * "A banner appears above the content area on other screens whenever there are pending items,
 * linking to this screen." Also shown when the demo "Offline" toggle is on, matching the
 * prototype's `showSyncBanner: s.offlineMode || pendingCount > 0`.
 */
@Composable
fun SyncBanner(
    pendingCount: Int,
    isOffline: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val text = when {
        isOffline && pendingCount > 0 -> "Offline — $pendingCount item${if (pendingCount == 1) "" else "s"} waiting to sync"
        isOffline -> "You're offline — submissions will sync automatically when reconnected"
        else -> "$pendingCount item${if (pendingCount == 1) "" else "s"} pending sync"
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(bottom = 8.dp)
            .background(Color.White.copy(alpha = 0.18f), RoundedCornerShape(TpmRadius.pill))
            .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.35f)), RoundedCornerShape(TpmRadius.pill))
            .clickable(onClickLabel = "Open the sync queue", onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Cloud, contentDescription = null, tint = TpmColors.White, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = TpmColors.White,
            modifier = Modifier.weight(1f),
        )
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TpmColors.White, modifier = Modifier.size(16.dp))
    }
}
