package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius

/**
 * The .seg / .seg-opt segmented control — used for Severity (High/Medium/Low), DRI Status
 * (Ongoing/Resolved), and Final Verification's Yes/No confirmation. Selected option is
 * accent-filled with bg-colored text; others are plain with a hairline divider between options.
 */
@Composable
fun <T> TpmSegmentedControl(
    options: List<T>,
    selected: T?,
    onSelect: (T) -> Unit,
    labelFor: (T) -> String,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(TpmRadius.small)
    Row(
        modifier = modifier
            .clip(shape)
            .border(BorderStroke(1.dp, TpmColors.Divider), shape),
    ) {
        options.forEachIndexed { index, option ->
            if (index > 0) {
                Box(
                    modifier = Modifier
                        .width(1.dp)
                        .fillMaxHeight()
                        .background(TpmColors.Divider),
                )
            }
            val isSelected = option == selected
            Row(
                modifier = Modifier
                    .weight(1f)
                    .background(if (isSelected) TpmColors.Accent else Color.Transparent)
                    .clickable { onSelect(option) }
                    .padding(vertical = 10.dp, horizontal = 8.dp),
            ) {
                Text(
                    text = labelFor(option),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isSelected) TpmColors.Background else TpmColors.Text,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
