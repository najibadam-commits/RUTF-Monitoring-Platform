package org.tpmnigeria.tpm.ui.wizard.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.domain.formatCoords
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTag
import org.tpmnigeria.tpm.ui.components.TpmTagVariant
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/** README's "GPS Capture" step content, shared by all three wizards. */
@Composable
fun GpsCaptureStep(gps: GpsCapture?, onOpenGpsModal: () -> Unit) {
    Column {
        TpmCard(blueprint = true, modifier = Modifier.fillMaxWidth()) {
            if (gps != null) {
                Text(
                    formatCoords(gps.lat, gps.lng),
                    style = MaterialTheme.typography.bodyLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                )
                TpmTag("±${gps.accuracyMeters}m accuracy", TpmTagVariant.Neutral)
            } else {
                Text("Not captured yet.", style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
            }
        }
        Spacer(Modifier.height(TpmSpacing.space3))
        TpmButton(
            text = if (gps != null) "Recapture GPS" else "Capture GPS Location",
            icon = Icons.Filled.Place,
            onClick = onOpenGpsModal,
            variant = if (gps != null) TpmButtonVariant.Secondary else TpmButtonVariant.Primary,
            blueprint = true,
            fullWidth = true,
        )
    }
}

/** README's "MOV Photo"/"Selfie" step content, shared by all three wizards — 48dp icon tile +
 *  label/hint + capture button (camera-only, no gallery). */
@Composable
fun PhotoCaptureStep(
    label: String,
    hint: String,
    photoPath: String?,
    icon: ImageVector,
    onOpenCamera: () -> Unit,
) {
    Column {
        TpmCard(blueprint = true, modifier = Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space3)) {
                Icon(
                    if (photoPath != null) Icons.Filled.Check else icon,
                    contentDescription = null,
                    tint = if (photoPath != null) TpmColors.Accent700 else TpmColors.Neutral500,
                    modifier = Modifier.size(48.dp),
                )
                Column {
                    Text(label, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        if (photoPath != null) "Captured — tap below to retake." else hint,
                        style = MaterialTheme.typography.bodySmall,
                        color = TpmColors.TextMuted,
                    )
                }
            }
        }
        Spacer(Modifier.height(TpmSpacing.space3))
        TpmButton(
            text = if (photoPath != null) "Retake Photo" else "Capture Photo",
            icon = Icons.Filled.CameraAlt,
            onClick = onOpenCamera,
            variant = if (photoPath != null) TpmButtonVariant.Secondary else TpmButtonVariant.Primary,
            blueprint = true,
            fullWidth = true,
        )
    }
}
