package org.tpmnigeria.tpm.ui.theme

import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp

/**
 * The design system's signature "blueprint" motif: four small L-shaped corner brackets drawn
 * just outside each corner of a card/button, evoking a technical-drawing registration mark.
 * See README "Signature motif" and the `.blueprint > .corner` rules in _ds_styles.css (the CSS
 * draws a plus-shaped cross per corner via ::before/::after; this recreates the README's simpler,
 * explicitly-described L-bracket instead — see the note in Dimens.kt on following the README
 * where it and the CSS disagree).
 *
 * Usage: `Modifier.blueprintCorners()` — draws on top of the content, brackets extend slightly
 * outside the composable's bounds so pair it with a little extra padding/margin from neighbors.
 */
fun Modifier.blueprintCorners(
    color: Color? = null,
    armLength: Dp = TpmBlueprint.armLength,
    strokeWidth: Dp = TpmBlueprint.strokeWidth,
): Modifier = composed {
    val brushColor = color ?: TpmColors.Accent
    this.drawWithContent {
        drawContent()
        val arm = armLength.toPx()
        val stroke = strokeWidth.toPx()
        val w = size.width
        val h = size.height
        val inset = stroke / 2f

        // Top-left
        drawLine(brushColor, Offset(-inset, arm), Offset(-inset, -inset), stroke)
        drawLine(brushColor, Offset(-inset, -inset), Offset(arm, -inset), stroke)
        // Top-right
        drawLine(brushColor, Offset(w - arm, -inset), Offset(w + inset, -inset), stroke)
        drawLine(brushColor, Offset(w + inset, -inset), Offset(w + inset, arm), stroke)
        // Bottom-left
        drawLine(brushColor, Offset(-inset, h - arm), Offset(-inset, h + inset), stroke)
        drawLine(brushColor, Offset(-inset, h + inset), Offset(arm, h + inset), stroke)
        // Bottom-right
        drawLine(brushColor, Offset(w + inset, h - arm), Offset(w + inset, h + inset), stroke)
        drawLine(brushColor, Offset(w + inset, h + inset), Offset(w - arm, h + inset), stroke)
    }
}
