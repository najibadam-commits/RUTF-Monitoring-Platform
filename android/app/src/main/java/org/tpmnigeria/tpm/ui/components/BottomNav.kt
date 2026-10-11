package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.selectable
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.draw.shadow
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
    // Glass design (R164): a white bar with a soft top shadow; the selected tab sits on a tinted pill.
    Row(
        modifier = modifier
            .shadow(12.dp, RectangleShape, ambientColor = TpmColors.Blue.copy(alpha = 0.2f), spotColor = TpmColors.Blue.copy(alpha = 0.2f))
            .background(TpmColors.White)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(horizontal = 6.dp, vertical = 6.dp),
    ) {
        items.forEach { item ->
            val selected = item.route == currentRoute
            Column(
                modifier = Modifier
                    .weight(1f)
                    .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(item.route) })
                    .heightIn(min = 52.dp)
                    .padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    contentAlignment = Alignment.TopEnd,
                    modifier = Modifier
                        .background(if (selected) TpmColors.Accent100 else Color.Transparent, RoundedCornerShape(TpmRadius.pill))
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                ) {
                    Icon(
                        item.icon,
                        contentDescription = item.label,
                        tint = if (selected) TpmColors.Accent700 else TpmColors.Neutral600,
                        modifier = Modifier.size(22.dp),
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
                    color = if (selected) TpmColors.Accent700 else TpmColors.Neutral600,
                )
            }
        }
    }
}
