package org.tpmnigeria.tpm.ui.wizard.attendance

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.local.AttendanceEntity
import org.tpmnigeria.tpm.domain.formatCoords
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.components.modal.GpsCaptureModal
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import org.tpmnigeria.tpm.ui.wizard.common.GpsCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardModal
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel

/**
 * Items 9-15 — "Daily Attendance". Field Monitor identity/date are implicit (current session /
 * today, never editable — see README-style master prompt: "auto-populated," "auto date"); the
 * only inputs are the two camera-only photos and a GPS fix, exactly like a NewIssueWizard step,
 * not a form.
 */
@Composable
fun DailyAttendanceScreen(onDone: () -> Unit, onExit: () -> Unit) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val context = LocalContext.current
    val viewModel = rememberWizardViewModel { DailyAttendanceViewModel(repository, session, context.applicationContext) }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    var activeModal by remember { mutableStateOf<WizardModal?>(null) }

    val handleBack = { if (!viewModel.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    if (viewModel.isChecking) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val existing = viewModel.alreadySubmittedToday
    if (existing != null) {
        AlreadySubmittedCard(existing, onClose = onExit)
        return
    }

    WizardScaffold(
        stepIndex = viewModel.step,
        totalSteps = ATTENDANCE_STEP_COUNT,
        stepLabel = ATTENDANCE_STEP_LABELS[viewModel.step - 1],
        isStepValid = viewModel.isCurrentStepValid,
        warningText = viewModel.warningText,
        isSubmitting = viewModel.isSubmitting,
        continueLabel = if (viewModel.step == ATTENDANCE_STEP_COUNT) "Submit Attendance" else "Continue",
        onContinue = {
            if (viewModel.step == ATTENDANCE_STEP_COUNT) {
                scope.launch {
                    val record = viewModel.submit()
                    if (record != null) {
                        toast.show("Attendance recorded for today.")
                        onDone()
                    }
                }
            } else {
                viewModel.next()
            }
        },
    ) {
        when (viewModel.step) {
            1 -> PhotoCaptureStep(
                label = "Selfie",
                hint = "Confirms you're the one submitting attendance — required.",
                photoPath = viewModel.selfiePhotoPath,
                icon = Icons.Filled.Person,
                onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = true, label = "Selfie") },
            )
            2 -> PhotoCaptureStep(
                label = "Assignment Location Photo",
                hint = "Capture a photo of where you're stationed today — required.",
                photoPath = viewModel.locationPhotoPath,
                icon = Icons.Filled.CameraAlt,
                onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = false, label = "Assignment Location") },
            )
            3 -> GpsCaptureStep(viewModel.gps, onOpenGpsModal = { activeModal = WizardModal.Gps })
            4 -> AttendanceReviewStep(viewModel)
        }
        if (viewModel.submitError != null) {
            Text(viewModel.submitError.orEmpty(), color = TpmColors.Accent800, style = MaterialTheme.typography.bodySmall)
        }
    }

    when (val modal = activeModal) {
        WizardModal.Gps -> GpsCaptureModal(
            onDismiss = { activeModal = null },
            onUseLocation = { viewModel.gps = it; activeModal = null },
        )
        is WizardModal.Camera -> CameraCaptureModal(
            title = modal.label,
            useFrontCamera = modal.useFrontCamera,
            onDismiss = { activeModal = null },
            onPhotoCaptured = { path ->
                if (modal.useFrontCamera) viewModel.selfiePhotoPath = path else viewModel.locationPhotoPath = path
                activeModal = null
            },
        )
        WizardModal.Voice, null -> {}
    }
}

@Composable
private fun AttendanceReviewStep(vm: DailyAttendanceViewModel) {
    Column {
        TpmCard(modifier = Modifier.fillMaxWidth()) {
            ReviewRow("Date", vm.today.toString())
            ReviewRow("GPS", vm.gps?.let { "${formatCoords(it.lat, it.lng)} (±${it.accuracyMeters}m)" }.orEmpty())
            ReviewRow("Selfie", if (vm.selfiePhotoPath != null) "Captured" else "—")
            ReviewRow("Assignment Location Photo", if (vm.locationPhotoPath != null) "Captured" else "—")
        }
        Text(
            "Once submitted, today's attendance can't be edited or re-submitted from this device.",
            style = MaterialTheme.typography.bodySmall,
            color = TpmColors.TextMuted,
            modifier = Modifier.padding(top = TpmSpacing.space2),
        )
    }
}

@Composable
private fun AlreadySubmittedCard(record: AttendanceEntity, onClose: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(TpmSpacing.space4), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(modifier = Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Filled.CheckCircle, contentDescription = null,
                tint = TpmColors.Accent700, modifier = Modifier.height(56.dp),
            )
        }
        Text("Attendance already recorded for today", style = MaterialTheme.typography.titleMedium)
        Text(
            "One record per day — you can't submit again until tomorrow.",
            style = MaterialTheme.typography.bodySmall,
            color = TpmColors.TextMuted,
        )
        Spacer(Modifier.height(TpmSpacing.space4))
        TpmCard(modifier = Modifier.fillMaxWidth()) {
            ReviewRow("Date", record.attendanceDate)
            ReviewRow("GPS", "${formatCoords(record.lat, record.lng)} (±${record.gpsAccuracyM}m)")
        }
        Spacer(Modifier.height(TpmSpacing.space4))
        TpmButton(text = "Back to Home", onClick = onClose, variant = TpmButtonVariant.Secondary, blueprint = true, fullWidth = true)
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
