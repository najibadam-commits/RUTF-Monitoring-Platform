package org.tpmnigeria.tpm.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Spacing scale on 4dp increments (glass design system, DECISIONS R164): 8–12dp between related
 * controls, 16–20dp screen and card padding. The step names are the original ones (5 and 7 are
 * absent) so every screen keeps its relative spacing.
 */
object TpmSpacing {
    val space1 = 4.dp
    val space2 = 8.dp
    val space3 = 12.dp
    val space4 = 16.dp
    val space6 = 24.dp
    val space8 = 32.dp
}

/**
 * Corner radius scale.
 *
 * NOTE on a spec discrepancy: _ds_styles.css defines --radius-sm/md/lg (2/4/7px) but then a later
 * "blueprint frame" rule block zeroes radius on .card/.btn/.input/.tag/.seg/.dialog entirely
 * (square, wireframe-style). The handoff README — which CLAUDE_CODE_PROMPT.md names the spec of
 * record, with the CSS/HTML demoted to supporting reference — instead describes "small/medium
 * rounded corners on inputs and cards (~6–8dp equivalent)" and "rounded-pill" tags. This build
 * follows the README consistently on both points (rounded, not square) rather than mixing the
 * two sources per-detail.
 */
object TpmRadius {
    val small = 14.dp   // inputs, segmented controls
    val medium = 20.dp  // cards, panels
    val large = 24.dp   // sheets, hero panels
    val pill = 999.dp   // buttons, tags
}

/** Elevation for glass panels: soft and restrained. */
object TpmElevation {
    val card = 6.dp
    val raised = 10.dp
}

/** Blueprint corner-bracket geometry (Modifier.blueprintCorners()) — see README's "Signature motif". */
object TpmBlueprint {
    val armLength = 8.dp
    val strokeWidth = 1.5.dp
}
