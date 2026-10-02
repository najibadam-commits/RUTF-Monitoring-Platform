package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors

data class BottomNavEntry(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val badge: Boolean = false,
)

/** The 5-tab bottom nav — visible on top-level screens only (README "App Structure & Navigation"). */
@Composable
fun TpmBottomNav(
    items: List<BottomNavEntry>,
    currentRoute: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .background(TpmColors.Background)
            .border(BorderStroke(1.dp, TpmColors.Divider))
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        items.forEach { item ->
            val selected = item.route == currentRoute
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(item.route) }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(contentAlignment = Alignment.TopEnd) {
                    Icon(
                        item.icon,
                        contentDescription = item.label,
                        tint = if (selected) TpmColors.Accent800 else TpmColors.Text.copy(alpha = 0.62f),
                        modifier = Modifier.size(20.dp),
                    )
                    if (item.badge) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .background(TpmColors.Accent, CircleShape),
                        )
                    }
                }
                Text(
                    item.label,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected) TpmColors.Accent800 else TpmColors.Text.copy(alpha = 0.62f),
                )
            }
        }
    }
}
