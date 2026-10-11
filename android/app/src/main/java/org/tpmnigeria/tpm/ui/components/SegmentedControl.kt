package org.tpmnigeria.tpm.ui.components

import org.tpmnigeria.tpm.ui.theme.TpmGradients
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.selectable
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
    // Glass design (R164): a soft pill track; the selected option is a gradient pill with white text.
    val track = RoundedCornerShape(TpmRadius.small)
    val pill = RoundedCornerShape(TpmRadius.small - 3.dp)
    Row(
        modifier = modifier
            .clip(track)
            .background(TpmColors.SurfaceSubtle, track)
            .border(BorderStroke(1.dp, TpmColors.Divider), track)
            .padding(3.dp),
    ) {
        options.forEach { option ->
            val isSelected = option == selected
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(pill)
                    .then(if (isSelected) Modifier.background(TpmGradients.Button, pill) else Modifier)
                    .selectable(selected = isSelected, role = Role.RadioButton, onClick = { onSelect(option) })
                    .heightIn(min = 44.dp)
                    .padding(vertical = 10.dp, horizontal = 6.dp),
            ) {
                Text(
                    text = labelFor(option),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isSelected) TpmColors.White else TpmColors.Text,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
