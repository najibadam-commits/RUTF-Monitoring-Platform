package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius

/**
 * Visual variants matching .tag-accent / .tag-neutral / .tag-outline in _ds_styles.css.
 * (.tag-accent-2 exists in the CSS ramp but nothing in the README's status/severity mapping
 * calls for it, so it's omitted here.) Status/severity → variant mapping lives in the domain
 * layer (see StatusMeta.kt / SeverityMeta.kt) — this file only knows how to paint a tag.
 */
enum class TpmTagVariant { Accent, Neutral, Outline }

@Composable
fun TpmTag(
    label: String,
    variant: TpmTagVariant,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(TpmRadius.pill)
    val (bg, fg, borderColor) = when (variant) {
        TpmTagVariant.Accent -> Triple(TpmColors.Accent100, TpmColors.Accent800, null)
        TpmTagVariant.Neutral -> Triple(TpmColors.Neutral100, TpmColors.Neutral800, null)
        TpmTagVariant.Outline -> Triple(Color.Transparent, TpmColors.Accent, TpmColors.Accent)
    }
    var m = modifier.clip(shape).background(bg, shape)
    if (borderColor != null) m = m.border(BorderStroke(1.dp, borderColor), shape)
    Text(
        text = label,
        color = fg,
        style = MaterialTheme.typography.labelMedium,
        modifier = m.padding(horizontal = 10.dp, vertical = 3.dp),
    )
}
