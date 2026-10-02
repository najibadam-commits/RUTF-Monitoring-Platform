package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

private fun Modifier.bottomDivider(color: androidx.compose.ui.graphics.Color) = drawBehind {
    val strokeWidthPx = 1.dp.toPx()
    drawLine(
        color = color,
        start = androidx.compose.ui.geometry.Offset(0f, size.height - strokeWidthPx / 2),
        end = androidx.compose.ui.geometry.Offset(size.width, size.height - strokeWidthPx / 2),
        strokeWidth = strokeWidthPx,
    )
}

/**
 * Shared list row used on Home ("Recent Issues") and Issue List — README §2/§3: Issue ID (bold)
 * + up to two muted detail lines on the left, status tag + optional overdue tag stacked on the
 * right, hairline divider below (matches the prototype's listRowStyle borderBottom).
 */
@Composable
fun IssueRow(
    issueId: String,
    line2: String,
    statusLabel: String,
    statusVariant: TpmTagVariant,
    overdue: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    line3: String? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .bottomDivider(TpmColors.Divider)
            .padding(vertical = TpmSpacing.space3, horizontal = TpmSpacing.space1),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(issueId, style = MaterialTheme.typography.titleMedium)
            Text(line2, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            if (line3 != null) {
                Text(line3, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            TpmTag(statusLabel, statusVariant)
            if (overdue) {
                Spacer(Modifier.height(3.dp))
                TpmTag("Overdue", TpmTagVariant.Outline)
            }
        }
    }
}
