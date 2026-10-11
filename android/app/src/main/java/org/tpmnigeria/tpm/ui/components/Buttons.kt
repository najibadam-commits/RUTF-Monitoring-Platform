package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmGradients
import org.tpmnigeria.tpm.ui.theme.TpmRadius

enum class TpmButtonVariant { Primary, Secondary, Ghost }

/**
 * The design system's single button component (glass design, DECISIONS R164): pill-shaped, at
 * least 48dp tall. Primary = blue → cyan gradient with white text and a soft shadow; Secondary =
 * white with a thin blue edge and deep-blue text; Ghost = deep-blue text, no surface. Disabled is
 * 45% opacity and not clickable. [blueprint] is kept for callers and gives the primary button a
 * slightly stronger shadow (it marks a screen's main action).
 */
@Composable
fun TpmButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: TpmButtonVariant = TpmButtonVariant.Primary,
    enabled: Boolean = true,
    blueprint: Boolean = false,
    fullWidth: Boolean = false,
    icon: ImageVector? = null,
) {
    val shape = RoundedCornerShape(TpmRadius.pill)
    var m = modifier
    if (variant != TpmButtonVariant.Ghost) m = m.heightIn(min = 50.dp)
    if (fullWidth) m = m.fillMaxWidth()

    val content: @Composable RowScope.() -> Unit = {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center)
    }

    when (variant) {
        TpmButtonVariant.Primary -> Box(
            modifier = m
                .then(if (enabled) Modifier.shadow(if (blueprint) 8.dp else 4.dp, shape, ambientColor = TpmColors.Blue.copy(alpha = 0.35f), spotColor = TpmColors.Blue.copy(alpha = 0.4f)) else Modifier)
                .background(TpmGradients.Button, shape)
                .alpha(if (enabled) 1f else 0.45f),
        ) {
            Button(
                onClick = onClick,
                modifier = Modifier.matchParentSizeOr(fullWidth).heightIn(min = 50.dp),
                enabled = enabled,
                shape = shape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.Transparent,
                    contentColor = TpmColors.White,
                    disabledContainerColor = Color.Transparent,
                    disabledContentColor = TpmColors.White,
                ),
                contentPadding = PaddingValues(horizontal = 22.dp, vertical = 12.dp),
                elevation = null,
                content = content,
            )
        }
        TpmButtonVariant.Secondary -> OutlinedButton(
            onClick = onClick,
            modifier = m,
            enabled = enabled,
            shape = shape,
            colors = ButtonDefaults.outlinedButtonColors(
                containerColor = TpmColors.White,
                contentColor = TpmColors.Accent700,
                disabledContainerColor = TpmColors.White.copy(alpha = 0.6f),
                disabledContentColor = TpmColors.Accent700.copy(alpha = 0.45f),
            ),
            border = BorderStroke(1.dp, if (enabled) TpmColors.Accent300 else TpmColors.Accent300.copy(alpha = 0.45f)),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            content = content,
        )
        TpmButtonVariant.Ghost -> TextButton(
            onClick = onClick,
            modifier = m.heightIn(min = 44.dp),
            enabled = enabled,
            shape = shape,
            colors = ButtonDefaults.textButtonColors(
                contentColor = TpmColors.Accent700,
                disabledContentColor = TpmColors.Accent700.copy(alpha = 0.45f),
            ),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
            content = content,
        )
    }
}

/** A full-width button fills its gradient box; otherwise the box wraps the button. */
private fun Modifier.matchParentSizeOr(fullWidth: Boolean): Modifier = if (fullWidth) this.fillMaxWidth() else this
