package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import org.tpmnigeria.tpm.ui.theme.blueprintCorners

/**
 * The ".card" component — surface-filled, divider-bordered, medium-radius rounded rectangle,
 * laid out as a vertical stack with the design system's card gap (--space-2). Pass
 * [blueprint] = true for the corner-bracket treatment used on "key cards" (README: header cards,
 * evidence tiles, GPS capture card, review summaries) — plain cards (KPI tiles, list rows) leave
 * it off.
 */
@Composable
fun TpmCard(
    modifier: Modifier = Modifier,
    blueprint: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(TpmSpacing.space3),
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(TpmRadius.medium)
    var m = modifier
        .clip(shape)
        .background(TpmColors.Surface, shape)
        .border(BorderStroke(1.dp, TpmColors.Divider), shape)
    if (blueprint) m = m.blueprintCorners()
    Column(
        modifier = m.padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
        content = content,
    )
}
