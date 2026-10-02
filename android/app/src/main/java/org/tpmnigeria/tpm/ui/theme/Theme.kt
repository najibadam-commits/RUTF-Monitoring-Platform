package org.tpmnigeria.tpm.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

/**
 * The design is light-only per the spec (no dark-mode tokens defined anywhere in _ds_styles.css
 * or the README) — so this theme does not branch on system dark mode. If dark mode is ever
 * requested, it needs new tokens from design first.
 */
private val TpmColorScheme = lightColorScheme(
    primary = TpmColors.Accent,
    onPrimary = TpmColors.Background,
    primaryContainer = TpmColors.Accent100,
    onPrimaryContainer = TpmColors.Accent800,
    secondary = TpmColors.Accent700,
    background = TpmColors.Background,
    onBackground = TpmColors.Text,
    surface = TpmColors.Surface,
    onSurface = TpmColors.Text,
    surfaceVariant = TpmColors.Neutral200,
    onSurfaceVariant = TpmColors.Neutral800,
    outline = TpmColors.Divider,
    error = TpmColors.Accent800,
    onError = TpmColors.Background,
)

private val TpmShapes = Shapes(
    extraSmall = RoundedCornerShape(TpmRadius.small),
    small = RoundedCornerShape(TpmRadius.small),
    medium = RoundedCornerShape(TpmRadius.medium),
    large = RoundedCornerShape(TpmRadius.large),
    extraLarge = RoundedCornerShape(TpmRadius.large),
)

@Composable
fun TpmTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = TpmColorScheme,
        typography = TpmTypography,
        shapes = TpmShapes,
        content = content,
    )
}
