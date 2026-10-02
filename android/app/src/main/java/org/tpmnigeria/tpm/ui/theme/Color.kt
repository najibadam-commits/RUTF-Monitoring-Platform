package org.tpmnigeria.tpm.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Design tokens transcribed 1:1 from `_ds_styles.css` / the README's Design Tokens section.
 * This is the single source of truth for color in the app — screens should reference
 * [TpmColors] (via [LocalTpmColors]/[MaterialTheme]) rather than hardcoding hex values.
 */
object TpmColors {
    // Base
    val Background = Color(0xFFF2F2F3)
    val Surface = Color(0xFFE9E9EA)
    val Text = Color(0xFF1D1F20)
    val Divider = Color(0x291D1F20) // --color-text @ 16% opacity

    // Accent ramp (primary brand blue)
    val Accent100 = Color(0xFFEEF6FF)
    val Accent200 = Color(0xFFD6EBFF)
    val Accent300 = Color(0xFFB5D9FD)
    val Accent400 = Color(0xFF94BCE3)
    val Accent500 = Color(0xFF749DC4)
    val Accent600 = Color(0xFF597EA3)
    val Accent700 = Color(0xFF416180)
    val Accent800 = Color(0xFF2C455D)
    val Accent900 = Color(0xFF1D2D3D)
    val Accent = Accent600 // #5980a6 per README; matches the ramp's 600 step

    // Neutral ramp
    val Neutral100 = Color(0xFFF5F5F8)
    val Neutral200 = Color(0xFFE7E7EA)
    val Neutral300 = Color(0xFFD4D4D7)
    val Neutral400 = Color(0xFFB7B7BA)
    val Neutral500 = Color(0xFF98989B)
    val Neutral600 = Color(0xFF7A7A7D)
    val Neutral700 = Color(0xFF5D5D60)
    val Neutral800 = Color(0xFF424244)
    val Neutral900 = Color(0xFF2B2B2D)

    // Text-muted: --color-text @ 55% opacity
    val TextMuted = Color(0x8C1D1F20)

    // Blueprint corner-bracket color: --color-text @ 55% opacity (see .blueprint > .corner in CSS)
    val BlueprintCorner = Color(0x8C1D1F20)
}
