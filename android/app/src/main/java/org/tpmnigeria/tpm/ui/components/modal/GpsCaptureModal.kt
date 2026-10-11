package org.tpmnigeria.tpm.ui.components.modal

import android.Manifest
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import org.tpmnigeria.tpm.domain.formatCoords
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmTag
import org.tpmnigeria.tpm.ui.components.TpmTagVariant
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import kotlin.math.roundToInt

/** Accuracy (meters) above which we show the "recapture for a more precise fix" copy — matches
 *  the prototype's `gpsModal.poor` low-accuracy warning, threshold chosen to roughly mirror its
 *  simulated 3–14m jitter range where "poor" reads noticeably worse than typical. */
private const val POOR_ACCURACY_THRESHOLD_M = 15

private enum class GpsPhase { RequestingPermission, PermissionDenied, Acquiring, Done, Error }

/**
 * README "Shared modals — GPS capture modal": acquiring (pulsing radar ring around the app-mark
 * pin icon) → result (monospace coordinates, accuracy pill, low-accuracy warning) → Recapture /
 * Use Location. Real capture via FusedLocationProviderClient (single high-accuracy fix), not
 * simulated.
 */
@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun GpsCaptureModal(
    onDismiss: () -> Unit,
    onUseLocation: (GpsCapture) -> Unit,
) {
    val context = LocalContext.current
    var phase by remember { mutableStateOf(GpsPhase.RequestingPermission) }
    var result by remember { mutableStateOf<GpsCapture?>(null) }
    var errorText by remember { mutableStateOf<String?>(null) }
    var captureRequestId by remember { mutableStateOf(0) }

    val permissionState = rememberMultiplePermissionsState(
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
    )
    val hasLocationPermission = permissionState.permissions.any { it.status.isGranted }

    LaunchedEffect(Unit) {
        if (!hasLocationPermission) permissionState.launchMultiplePermissionRequest()
    }

    LaunchedEffect(hasLocationPermission, captureRequestId) {
        if (!hasLocationPermission) {
            phase = GpsPhase.PermissionDenied
            return@LaunchedEffect
        }
        phase = GpsPhase.Acquiring
        errorText = null
        try {
            val client = LocationServices.getFusedLocationProviderClient(context)
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setDurationMillis(15_000)
                .build()
            val location = client.getCurrentLocation(request, null).await()
            if (location == null) {
                phase = GpsPhase.Error
                errorText = "Couldn't get a location fix. Move to an open area and try again."
            } else {
                result = GpsCapture(location.latitude, location.longitude, location.accuracy.roundToInt())
                phase = GpsPhase.Done
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            phase = GpsPhase.Error
            errorText = "Location capture failed: ${e.message ?: "unknown error"}"
        }
    }

    TpmDialog(title = "Capture GPS Location", onDismiss = onDismiss) {
        when (phase) {
            GpsPhase.RequestingPermission -> Column(
                modifier = Modifier.fillMaxWidth().height(120.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Waiting for location permission…", style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
            }
            GpsPhase.PermissionDenied -> Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Location permission is required to capture GPS for this finding. Grant it to continue.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.Warning,
                )
                Spacer(Modifier.height(TpmSpacing.space3))
                TpmButton(
                    text = "Grant Permission",
                    onClick = { permissionState.launchMultiplePermissionRequest() },
                    blueprint = true,
                    fullWidth = true,
                )
            }
            GpsPhase.Acquiring -> Column(
                modifier = Modifier.fillMaxWidth().height(150.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                RadarPulse()
                Spacer(Modifier.height(TpmSpacing.space3))
                Text("Acquiring GPS signal…", style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
            }
            GpsPhase.Error -> Column(modifier = Modifier.fillMaxWidth()) {
                Text(errorText.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = TpmColors.Error)
                Spacer(Modifier.height(TpmSpacing.space3))
                TpmButton(text = "Try Again", onClick = { captureRequestId++ }, blueprint = true, fullWidth = true)
            }
            GpsPhase.Done -> {
                val gps = result
                if (gps != null) {
                    val poor = gps.accuracyMeters > POOR_ACCURACY_THRESHOLD_M
                    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            formatCoords(gps.lat, gps.lng),
                            style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        )
                        Spacer(Modifier.height(TpmSpacing.space2))
                        TpmTag("±${gps.accuracyMeters}m accuracy", if (poor) TpmTagVariant.Outline else TpmTagVariant.Neutral)
                        if (poor) {
                            Spacer(Modifier.height(TpmSpacing.space2))
                            Text(
                                "Accuracy is low — recapture for a more precise fix, or continue if this is acceptable.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TpmColors.TextMuted,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                    Spacer(Modifier.height(TpmSpacing.space4))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                        TpmButton(text = "Recapture", onClick = { captureRequestId++ }, variant = TpmButtonVariant.Secondary, blueprint = true, modifier = Modifier.weight(1f))
                        TpmButton(text = "Use Location", onClick = { onUseLocation(gps) }, blueprint = true, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun RadarPulse() {
    val transition = rememberInfiniteTransition(label = "gps-radar")
    val scale by transition.animateFloat(
        initialValue = 0.85f, targetValue = 1.8f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "scale",
    )
    val alpha by transition.animateFloat(
        initialValue = 0.9f, targetValue = 0f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "alpha",
    )
    Box(modifier = Modifier.size(60.dp), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.size(60.dp)) {
            drawCircle(
                color = TpmColors.Accent,
                radius = (size.minDimension / 2.4f) * scale,
                alpha = alpha,
                style = Stroke(width = 3f),
            )
        }
        Icon(Icons.Filled.Place, contentDescription = null, tint = TpmColors.Accent, modifier = Modifier.size(26.dp))
    }
}
