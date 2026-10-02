package org.tpmnigeria.tpm.domain

import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.ui.components.TpmTagVariant

/**
 * Severity tag variant, transcribed from `severityCls` in TPM Field App.dc.html:
 *   High → outline, Medium → accent, Low → neutral.
 */
fun severityTagVariant(severity: Severity): TpmTagVariant = when (severity) {
    Severity.High -> TpmTagVariant.Outline
    Severity.Medium -> TpmTagVariant.Accent
    Severity.Low -> TpmTagVariant.Neutral
}

/** "{Severity} Priority" label used on Issue Detail's severity tag. */
fun Severity.priorityLabel(): String = "${this.name} Priority"

/**
 * Map-pin color per severity, from issue-map.jsx's `severityColor`:
 *   High → accent-800 (#2c455d), Medium → accent-600 (#5980a6), Low → neutral-500 (#98989b).
 */
fun severityMapColorHex(severity: Severity): String = when (severity) {
    Severity.High -> "#2C455D"
    Severity.Medium -> "#5980A6"
    Severity.Low -> "#98989B"
}
