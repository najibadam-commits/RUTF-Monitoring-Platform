package org.tpmnigeria.tpm.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Spacing scale — 1:1 port of --space-1..8 from _ds_styles.css (values are already a fixed
 * 3.4dp-multiple scale in the source; note 5 and 7 are intentionally absent, matching the CSS).
 */
object TpmSpacing {
    val space1 = 3.4.dp
    val space2 = 6.8.dp
    val space3 = 10.2.dp
    val space4 = 13.6.dp
    val space6 = 20.4.dp
    val space8 = 27.2.dp
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
    val small = 6.dp
    val medium = 8.dp
    val large = 12.dp
    val pill = 999.dp
}

/** Blueprint corner-bracket geometry (Modifier.blueprintCorners()) — see README's "Signature motif". */
object TpmBlueprint {
    val armLength = 8.dp
    val strokeWidth = 1.5.dp
}
