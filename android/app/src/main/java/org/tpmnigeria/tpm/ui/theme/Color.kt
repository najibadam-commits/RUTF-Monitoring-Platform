package org.tpmnigeria.tpm.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Design tokens — the RUTF-DTAP glass design system (DECISIONS R164), shared with the web
 * platform (web `globals.css`). Blue, cyan and turquoise gradients for headers, highlighted cards
 * and primary actions; near-white glass surfaces for content; cool-toned text. This is the single
 * source of truth for colour in the app — screens reference [TpmColors] rather than hex values.
 *
 * The token NAMES are those of the original design system (Accent ramp, Neutral ramp, Surface,
 * Divider…) so every existing screen picks up the new palette without being edited.
 */
object TpmColors {
    // Brand
    val Blue = Color(0xFF1687F8)
    val DeepBlue = Color(0xFF1264D8)
    val Cyan = Color(0xFF36C5E8)
    val Turquoise = Color(0xFF40D9C0)
    val Mint = Color(0xFF55D6AC)
    /** The RUTF-DTAP logo's green and navy (R166). */
    val LogoGreen = Color(0xFF24A324)
    val LogoNavy = Color(0xFF064687)
    val White = Color(0xFFFFFFFF)

    // Base
    val Background = Color(0xFFF4F9FD)
    /** Cards and panels: near-white glass (opaque enough for text outdoors). */
    val Surface = Color(0xF2FFFFFF)
    /** Inputs and inset areas inside a card. */
    val SurfaceSubtle = Color(0xFFF1F6FC)
    val Text = Color(0xFF19324D)
    val Divider = Color(0x2E1687F8) // blue @ 18%: a cool, thin border
    val GlassBorder = Color(0xB3FFFFFF) // white @ 70%: the light edge of a glass panel

    // Accent ramp (primary brand blue)
    val Accent100 = Color(0xFFE8F3FE)
    val Accent200 = Color(0xFFCFE6FD)
    val Accent300 = Color(0xFFA9D3FB)
    val Accent400 = Color(0xFF6FB4F9)
    val Accent500 = Color(0xFF3F9CF9)
    val Accent600 = Color(0xFF1687F8)
    val Accent700 = Color(0xFF1264D8)
    val Accent800 = Color(0xFF0F4EA8)
    val Accent900 = Color(0xFF0B3A7D)
    val Accent = Accent600

    // Neutral ramp (cool greys)
    val Neutral100 = Color(0xFFF3F7FB)
    val Neutral200 = Color(0xFFE4ECF4)
    val Neutral300 = Color(0xFFCCD8E4)
    val Neutral400 = Color(0xFFA9B9C9)
    val Neutral500 = Color(0xFF8798AA)
    val Neutral600 = Color(0xFF71869A)
    val Neutral700 = Color(0xFF55697D)
    val Neutral800 = Color(0xFF3A4E62)
    val Neutral900 = Color(0xFF243649)

    val TextMuted = Color(0xFF71869A)

    // Semantic (accessible on white; always paired with a word or icon, never colour alone)
    val Success = Color(0xFF1E8E5A)
    val SuccessBg = Color(0xFFE3F6EC)
    val Warning = Color(0xFFB45309)
    val WarningBg = Color(0xFFFDF0DF)
    val Error = Color(0xFFC62828)
    val ErrorBg = Color(0xFFFDE8E8)

    /** Kept for the old corner-bracket motif's API; the glass design no longer draws brackets. */
    val BlueprintCorner = Color(0x8019324D)
}

/** The design system's gradients. */
object TpmGradients {
    /** Headers, the sign-in background, primary buttons: blue → cyan. */
    val Primary = Brush.linearGradient(listOf(TpmColors.Blue, TpmColors.Cyan))
    /** Highlighted panels: deep blue → blue → turquoise. */
    val Hero = Brush.linearGradient(listOf(TpmColors.DeepBlue, TpmColors.Blue, TpmColors.Turquoise))
    /** A thin accent edge for highlighted cards: the logo's blue to its green (R166). */
    val Edge = Brush.linearGradient(listOf(TpmColors.Blue, TpmColors.Turquoise, TpmColors.LogoGreen))
    /** Horizontal version for buttons. */
    val Button = Brush.horizontalGradient(listOf(TpmColors.DeepBlue, TpmColors.Blue, TpmColors.Cyan))
}
