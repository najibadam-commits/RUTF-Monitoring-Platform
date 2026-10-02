package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.theme.blueprintCorners

enum class TpmButtonVariant { Primary, Secondary, Ghost }

/**
 * The design system's single button component (.btn/.btn-primary/.btn-secondary/.btn-ghost in
 * _ds_styles.css), reimplemented as one Composable with a variant switch rather than three
 * separate widgets — matches the README's "Buttons" token description: primary = accent
 * fill/bg text, secondary = surface fill/divider border, ghost = accent text/no border.
 * Disabled state is 45% opacity + non-interactive, exactly as specified.
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
    val shape = RoundedCornerShape(TpmRadius.medium)
    var finalModifier = modifier
    
    // Order matters: Height and Width first, then blueprint corners (which draw outside)
    if (variant != TpmButtonVariant.Ghost) finalModifier = finalModifier.height(46.dp)
    if (fullWidth) finalModifier = finalModifier.fillMaxWidth()
    if (blueprint) finalModifier = finalModifier.blueprintCorners()

    val content: @Composable RowScope.() -> Unit = {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.height(16.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }

    when (variant) {
        TpmButtonVariant.Primary -> Button(
            onClick = onClick,
            modifier = finalModifier,
            enabled = enabled,
            shape = shape,
            colors = ButtonDefaults.buttonColors(
                containerColor = TpmColors.Accent,
                contentColor = TpmColors.Background,
                disabledContainerColor = TpmColors.Accent.copy(alpha = 0.45f),
                disabledContentColor = TpmColors.Background.copy(alpha = 0.85f),
            ),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
            elevation = null, // flat "blueprint" design system — no drop shadows on controls
            content = content,
        )
        TpmButtonVariant.Secondary -> OutlinedButton(
            onClick = onClick,
            modifier = finalModifier,
            enabled = enabled,
            shape = shape,
            colors = ButtonDefaults.outlinedButtonColors(
                containerColor = TpmColors.Surface,
                contentColor = TpmColors.Text,
                disabledContainerColor = TpmColors.Surface.copy(alpha = 0.45f),
                disabledContentColor = TpmColors.Text.copy(alpha = 0.45f),
            ),
            border = BorderStroke(1.dp, if (enabled) TpmColors.Divider else TpmColors.Divider.copy(alpha = 0.45f)),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
            content = content,
        )
        TpmButtonVariant.Ghost -> TextButton(
            onClick = onClick,
            modifier = finalModifier,
            enabled = enabled,
            shape = shape,
            colors = ButtonDefaults.textButtonColors(
                contentColor = TpmColors.Accent,
                disabledContentColor = TpmColors.Accent.copy(alpha = 0.45f),
            ),
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
            content = content,
        )
    }
}
