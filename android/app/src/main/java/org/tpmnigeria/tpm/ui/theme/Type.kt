package org.tpmnigeria.tpm.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import org.tpmnigeria.tpm.R

/**
 * Barlow / Barlow Condensed, bundled as static font files (res/font) rather than fetched via the
 * downloadable-fonts API — this keeps type rendering correct offline and on emulators without
 * Google Play Services, which matters for a local-first field app. Weights match what the design
 * system actually uses (_ds_styles.css only ever asks for 400/600 on the heading face and
 * 400/500/700 on body).
 */
val BarlowCondensed = FontFamily(
    Font(R.font.barlow_condensed_regular, FontWeight.Normal),
    Font(R.font.barlow_condensed_semibold, FontWeight.SemiBold),
    Font(R.font.barlow_condensed_semibold, FontWeight.Bold),
)

val Barlow = FontFamily(
    Font(R.font.barlow_regular, FontWeight.Normal),
    Font(R.font.barlow_medium, FontWeight.Medium),
    Font(R.font.barlow_bold, FontWeight.Bold),
)

/**
 * Font-size scale transcribed from _ds_styles.css (h1..h6, body, card-*, tag, btn/input).
 * Heading styles use Barlow Condensed at weight 600 per --font-heading-weight; body copy uses
 * Barlow 400. Compose sp == CSS px at the default density scale, so values are a direct port.
 */
val TpmTypography = Typography(
    // h1 — 42px, used for the login title
    headlineLarge = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 42.sp, lineHeight = 47.sp, letterSpacing = (-0.015).sp),
    // h2 — 32px, Home greeting name / dialog-scale headings
    headlineMedium = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 32.sp, lineHeight = 36.sp, letterSpacing = (-0.015).sp),
    // h3 — 25px
    headlineSmall = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 25.sp, lineHeight = 28.sp),
    // h4 — 20px, screen/header titles, Issue ID on Issue Detail
    titleLarge = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 23.sp),
    // dialog-title — 20px but used at card/section-head scale in a few places
    titleMedium = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 20.sp), // .card-title
    // h6 — 13px uppercase, wizard step labels / section heads
    titleSmall = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 16.sp, letterSpacing = 0.08.sp),
    // body — 15px base
    bodyLarge = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 23.sp),
    // .card-body / general secondary copy — 13px
    bodyMedium = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 19.sp),
    // meta / caption text — 11px
    bodySmall = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Normal, fontSize = 11.sp, lineHeight = 15.sp),
    // .btn / .input — 14px, heading-weight for buttons (buttons use --font-heading per .btn CSS)
    labelLarge = TextStyle(fontFamily = BarlowCondensed, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 17.sp),
    // .tag — 11px
    labelMedium = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.02.sp),
    // .card-kicker — 10px uppercase, letter-spaced
    labelSmall = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 10.sp, lineHeight = 13.sp, letterSpacing = 0.1.sp),
)
