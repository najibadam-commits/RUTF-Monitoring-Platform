package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmGradients
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/**
 * The card — a glass panel (near-white surface, light edge, soft blue shadow, 20dp corners; see
 * [glass]) laid out as a vertical stack. Pass [blueprint] = true for "key cards" (header cards,
 * review summaries, the main action on a screen): they get a thin blue → turquoise gradient edge
 * (the glass design's replacement for the old corner-bracket motif, DECISIONS R164).
 */
@Composable
fun TpmCard(
    modifier: Modifier = Modifier,
    blueprint: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(TpmSpacing.space4),
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(TpmRadius.medium)
    var m = modifier.glass(shape)
    if (blueprint) m = m.border(BorderStroke(1.5.dp, TpmGradients.Edge), shape)
    Column(
        modifier = m.padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
        content = content,
    )
}
