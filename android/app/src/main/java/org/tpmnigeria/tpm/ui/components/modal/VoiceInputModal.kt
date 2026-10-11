package org.tpmnigeria.tpm.ui.components.modal

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.accompanist.permissions.shouldShowRationale
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.util.Locale

private enum class VoicePhase { RequestingPermission, PermissionDenied, PermissionPermanentlyDenied, Idle, Listening, Review }

/** Persists "we've already asked for RECORD_AUDIO at least once" — the one bit of state Android's
 *  permission API doesn't give you directly. `shouldShowRationale` alone can't tell "never asked
 *  yet" apart from "permanently denied" (both read false); this flag is what disambiguates them,
 *  which is what actually lets [VoiceInputModal] offer a working "Open Settings" path instead of a
 *  "Grant Permission" button that silently does nothing once Android stops showing the dialog. */
private const val PERMISSIONS_PREFS = "permissions_cache"
private const val KEY_RECORD_AUDIO_REQUESTED = "record_audio_requested"

private fun hasRequestedRecordAudioBefore(context: Context): Boolean =
    context.getSharedPreferences(PERMISSIONS_PREFS, Context.MODE_PRIVATE).getBoolean(KEY_RECORD_AUDIO_REQUESTED, false)

private fun markRecordAudioRequested(context: Context) {
    context.getSharedPreferences(PERMISSIONS_PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(KEY_RECORD_AUDIO_REQUESTED, true).apply()
}

/**
 * README "Shared modals — Voice-to-text modal": idle (tap-to-speak) → listening (animated
 * waveform) → transcript review (editable textarea) → Redo / Use Text. Real on-device speech
 * recognition via android.speech.SpeechRecognizer — no cloud dependency beyond what the OS itself
 * uses.
 *
 * Permission handling: accompanist's rememberPermissionState already refreshes on ON_RESUME (so
 * granting it from Settings and returning to the app is picked up automatically) — the actual gap
 * was that a *permanently* denied permission (Android's "don't ask again", or a second refusal)
 * makes launchPermissionRequest() a silent no-op: no dialog, no error, just nothing. The old
 * PermissionDenied phase only ever offered a "Grant Permission" button wired to
 * launchPermissionRequest() — which meant a user who'd permanently denied it had no way to ever
 * grant it again from inside the app. [hasRequestedRecordAudioBefore] plus
 * `!shouldShowRationale` (Android reads false there for BOTH "never asked" and "permanently
 * denied" — only the persisted flag tells them apart) now routes that case to a genuinely working
 * "Open App Settings" button instead.
 */
@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun VoiceInputModal(
    onDismiss: () -> Unit,
    onUseText: (String) -> Unit,
) {
    val context = LocalContext.current
    var phase by remember { mutableStateOf(VoicePhase.RequestingPermission) }
    var transcript by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf<String?>(null) }

    val permissionState = rememberPermissionState(Manifest.permission.RECORD_AUDIO)

    LaunchedEffect(Unit) {
        val status = permissionState.status
        // Auto-prompt whenever the dialog would actually appear (first-ever ask, or a soft denial
        // where shouldShowRationale is still true) — but never for a permanently denied
        // permission, where launchPermissionRequest() would silently no-op.
        val permanentlyDenied = hasRequestedRecordAudioBefore(context) && !status.isGranted && !status.shouldShowRationale
        if (!status.isGranted && !permanentlyDenied) {
            markRecordAudioRequested(context)
            permissionState.launchPermissionRequest()
        }
    }
    LaunchedEffect(permissionState.status) {
        val status = permissionState.status
        phase = when {
            status.isGranted -> VoicePhase.Idle
            hasRequestedRecordAudioBefore(context) && !status.shouldShowRationale -> VoicePhase.PermissionPermanentlyDenied
            else -> VoicePhase.PermissionDenied
        }
    }

    val recognizer = remember {
        if (SpeechRecognizer.isRecognitionAvailable(context)) SpeechRecognizer.createSpeechRecognizer(context) else null
    }
    DisposableEffect(Unit) {
        onDispose { recognizer?.destroy() }
    }

    fun startListening() {
        if (recognizer == null) {
            errorText = "Speech recognition isn't available on this device. Type your response instead."
            phase = VoicePhase.Review
            return
        }
        phase = VoicePhase.Listening
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: android.os.Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
                errorText = when (error) {
                    // Rare (permission revoked mid-session without the app ever backgrounding,
                    // e.g. via adb) — deliberately not routed back through RequestingPermission:
                    // that phase has no active trigger to re-check status and would just get
                    // stuck showing "Waiting…" forever instead. Idle + a clear message is safer.
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                        "Microphone permission was turned off — reopen this dialog to grant it again."
                    SpeechRecognizer.ERROR_NO_MATCH -> "Didn't catch that — tap the mic and try again."
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected — tap the mic and try again."
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                        "Voice recognition needs a network connection on this device — try again once you're online."
                    SpeechRecognizer.ERROR_AUDIO -> "Couldn't access the microphone — check nothing else is using it and try again."
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Voice recognition is busy — try again in a moment."
                    else -> "Voice input failed — tap the mic to try again, or type your response instead."
                }
                phase = VoicePhase.Idle
            }
            override fun onResults(results: android.os.Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                transcript = if (transcript.isBlank()) text else "$transcript $text"
                phase = VoicePhase.Review
            }
            override fun onPartialResults(partialResults: android.os.Bundle?) {}
            override fun onEvent(eventType: Int, params: android.os.Bundle?) {}
        })
        recognizer.startListening(intent)
    }

    TpmDialog(title = "Voice to Text", onDismiss = onDismiss) {
        when (phase) {
            VoicePhase.RequestingPermission -> Box(
                modifier = Modifier.fillMaxWidth().height(120.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Waiting for microphone permission…", style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
            }
            VoicePhase.PermissionDenied -> Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Microphone permission is required for voice input.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.Warning,
                )
                Spacer(Modifier.height(TpmSpacing.space3))
                TpmButton(text = "Grant Permission", onClick = { permissionState.launchPermissionRequest() }, blueprint = true, fullWidth = true)
            }
            VoicePhase.PermissionPermanentlyDenied -> Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Microphone access was turned off for this app. Enable it in Settings to use voice input.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.Warning,
                )
                Spacer(Modifier.height(TpmSpacing.space3))
                TpmButton(
                    text = "Open App Settings",
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    },
                    blueprint = true,
                    fullWidth = true,
                )
            }
            VoicePhase.Idle -> Column(
                modifier = Modifier.fillMaxWidth().height(160.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                if (errorText != null) {
                    Text(errorText.orEmpty(), style = MaterialTheme.typography.bodySmall, color = TpmColors.Error)
                    Spacer(Modifier.height(TpmSpacing.space2))
                }
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .background(TpmColors.Accent, CircleShape)
                        .clickable { startListening() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Mic, contentDescription = "Tap to speak", tint = TpmColors.Background)
                }
                Spacer(Modifier.height(TpmSpacing.space2))
                Text("Tap to speak", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
            VoicePhase.Listening -> Column(
                modifier = Modifier.fillMaxWidth().height(160.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                WaveformBars()
                Spacer(Modifier.height(TpmSpacing.space2))
                Text("Listening…", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
            VoicePhase.Review -> {
                TpmTextField(
                    label = "Transcript",
                    value = transcript,
                    onValueChange = { transcript = it },
                    singleLine = false,
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(TpmSpacing.space4))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                    TpmButton(text = "Redo", onClick = { transcript = ""; startListening() }, variant = TpmButtonVariant.Secondary, blueprint = true, modifier = Modifier.weight(1f))
                    TpmButton(text = "Use Text", onClick = { onUseText(transcript) }, blueprint = true, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun WaveformBars() {
    val transition = rememberInfiniteTransition(label = "voice-wave")
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(5) { index ->
            val scale by transition.animateFloat(
                initialValue = 0.3f, targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    tween(500, delayMillis = index * 80, easing = LinearEasing),
                    RepeatMode.Reverse,
                ),
                label = "bar$index",
            )
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(28.dp * scale)
                    .background(TpmColors.Accent),
            )
        }
    }
}
