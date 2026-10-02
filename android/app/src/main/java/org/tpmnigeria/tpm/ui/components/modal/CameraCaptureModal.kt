package org.tpmnigeria.tpm.ui.components.modal

import android.Manifest
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.tpmnigeria.tpm.domain.compressImageFileInPlace
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale

private enum class CameraPhase { RequestingPermission, PermissionDenied, Viewfinder, Captured }

/**
 * README "Shared modals — Camera capture modal": viewfinder ("Camera capture only — gallery
 * upload is disabled for evidence integrity.") → Capture → captured state (checkmark + timestamp
 * + "GPS attached") → Retake / Use Photo. Real CameraX capture to app-private storage — no
 * gallery/system picker is ever shown, satisfying the evidence-integrity requirement.
 */
@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun CameraCaptureModal(
    title: String,
    useFrontCamera: Boolean,
    onDismiss: () -> Unit,
    onPhotoCaptured: (filePath: String) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val coroutineScope = rememberCoroutineScope()
    var phase by remember { mutableStateOf(CameraPhase.RequestingPermission) }
    var capturedTimestamp by remember { mutableStateOf("") }
    var capturedPath by remember { mutableStateOf<String?>(null) }
    var isCapturing by remember { mutableStateOf(false) }

    // Allow user to manually flip even if the default was set by the screen.
    var isFrontCamera by remember { mutableStateOf(useFrontCamera) }

    val permissionState = rememberPermissionState(Manifest.permission.CAMERA)

    LaunchedEffect(Unit) {
        if (!permissionState.status.isGranted) permissionState.launchPermissionRequest()
    }
    LaunchedEffect(permissionState.status.isGranted) {
        phase = if (permissionState.status.isGranted) CameraPhase.Viewfinder else CameraPhase.PermissionDenied
    }

    val imageCapture = remember { ImageCapture.Builder().build() }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var previewView by remember { mutableStateOf<PreviewView?>(null) }

    // Re-bind camera whenever front/back toggle or provider/view becomes available.
    LaunchedEffect(isFrontCamera, cameraProvider, previewView, phase) {
        val provider = cameraProvider ?: return@LaunchedEffect
        val view = previewView ?: return@LaunchedEffect
        if (phase != CameraPhase.Viewfinder) return@LaunchedEffect

        val selector = if (isFrontCamera) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        val preview = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
        
        provider.unbindAll()
        try {
            if (provider.hasCamera(selector)) {
                provider.bindToLifecycle(lifecycleOwner, selector, preview, imageCapture)
            } else {
                // Fallback to back camera if front is requested but unavailable.
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
            }
        } catch (_: Exception) {
            // Camera bind can fail on emulators without a virtual camera configured.
        }
    }

    // Camera binding is tied to the Activity's lifecycle, not this Composable's — without this,
    // dismissing the dialog would leave the camera bound and streaming in the background.
    DisposableEffect(Unit) {
        onDispose { cameraProvider?.unbindAll() }
    }

    TpmDialog(title = title, onDismiss = onDismiss) {
        when (phase) {
            CameraPhase.RequestingPermission -> Box(
                modifier = Modifier.fillMaxWidth().height(200.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Waiting for camera permission…", style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
            }
            CameraPhase.PermissionDenied -> Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Camera permission is required to capture evidence photos.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.Accent800,
                )
                Spacer(Modifier.height(TpmSpacing.space3))
                TpmButton(
                    text = "Grant Permission",
                    onClick = { permissionState.launchPermissionRequest() },
                    blueprint = true,
                    fullWidth = true,
                )
            }
            CameraPhase.Viewfinder -> Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Camera capture only — gallery upload is disabled for evidence integrity.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TpmColors.TextMuted,
                )
                Spacer(Modifier.height(TpmSpacing.space2))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(3f / 4f),
                    contentAlignment = Alignment.Center,
                ) {
                    AndroidView(
                        modifier = Modifier.fillMaxWidth().aspectRatio(3f / 4f),
                        factory = { ctx ->
                            PreviewView(ctx).also {
                                previewView = it
                                ProcessCameraProvider.getInstance(ctx).addListener({
                                    cameraProvider = ProcessCameraProvider.getInstance(ctx).get()
                                }, ContextCompat.getMainExecutor(ctx))
                            }
                        },
                    )
                    
                    // Manual flip button as a fallback/convenience.
                    IconButton(
                        onClick = { isFrontCamera = !isFrontCamera },
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(TpmSpacing.space2),
                        colors = IconButtonDefaults.iconButtonColors(
                            containerColor = Color.Black.copy(alpha = 0.3f),
                            contentColor = Color.White
                        )
                    ) {
                        Icon(Icons.Filled.FlipCameraAndroid, contentDescription = "Switch Camera")
                    }

                    if (isCapturing) CircularProgressIndicator(color = TpmColors.Accent)
                }
                Spacer(Modifier.height(TpmSpacing.space3))
                TpmButton(
                    text = "Capture",
                    icon = Icons.Filled.CameraAlt,
                    onClick = {
                        if (isCapturing) return@TpmButton
                        isCapturing = true
                        val dir = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }
                        val fileName = "evidence_${System.currentTimeMillis()}.jpg"
                        val file = File(dir, fileName)
                        val outputOptions = ImageCapture.OutputFileOptions.Builder(file).build()
                        imageCapture.takePicture(
                            outputOptions,
                            ContextCompat.getMainExecutor(context),
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                    // takePicture's callback runs on the main executor — CameraX
                                    // wrote a full-resolution, uncompressed-by-us JPEG straight to
                                    // disk, and this is evidence that eventually has to travel over
                                    // often-poor field connectivity. Compress/downscale it off the
                                    // main thread before handing the (still uncompressed-looking,
                                    // but now shrunk) file back — keep the spinner up for that beat
                                    // rather than showing "Captured" for a file that isn't ready yet.
                                    coroutineScope.launch {
                                        withContext(Dispatchers.IO) {
                                            runCatching { compressImageFileInPlace(file) }
                                        }
                                        isCapturing = false
                                        capturedPath = file.absolutePath
                                        capturedTimestamp = SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date())
                                        phase = CameraPhase.Captured
                                    }
                                }
                                override fun onError(exception: ImageCaptureException) {
                                    isCapturing = false
                                    // Stay on the viewfinder — the user can just try Capture again.
                                }
                            },
                        )
                    },
                    blueprint = true,
                    fullWidth = true,
                )
            }
            CameraPhase.Captured -> {
                Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        modifier = Modifier.size(64.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Check, contentDescription = null, tint = TpmColors.Accent700, modifier = Modifier.size(30.dp))
                    }
                    Text("Captured at $capturedTimestamp", style = MaterialTheme.typography.bodyMedium)
                    Text("GPS attached", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                }
                Spacer(Modifier.height(TpmSpacing.space4))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                    TpmButton(
                        text = "Retake",
                        onClick = { phase = CameraPhase.Viewfinder },
                        variant = TpmButtonVariant.Secondary,
                        blueprint = true,
                        modifier = Modifier.weight(1f),
                    )
                    TpmButton(
                        text = "Use Photo",
                        onClick = { capturedPath?.let(onPhotoCaptured) },
                        blueprint = true,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}
