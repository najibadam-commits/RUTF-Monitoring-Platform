package org.tpmnigeria.tpm.ui.wizard.verification

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.statusMeta
import org.tpmnigeria.tpm.domain.model.locationLabel
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.IssueRow
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmSegmentedControl
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.components.modal.GpsCaptureModal
import org.tpmnigeria.tpm.ui.components.modal.VoiceInputModal
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.wizard.common.GpsCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardModal
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel

/** README §7 Final Verification — 5-step wizard. Submitting either closes the issue
 *  ("Verified / Closed") or reopens it ("Reopened", auto-routed back to the original DRI). */
@Composable
fun FinalVerifyWizardScreen(initialIssueId: String?, onDone: (issueId: String) -> Unit, onExit: () -> Unit) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val viewModel = rememberWizardViewModel { FinalVerifyWizardViewModel(repository, session, initialIssueId) }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    var activeModal by remember { mutableStateOf<WizardModal?>(null) }

    val handleBack = { if (!viewModel.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = viewModel.step,
        totalSteps = FINAL_VERIFY_STEP_COUNT,
        stepLabel = FINAL_VERIFY_STEP_LABELS[viewModel.step - 1],
        isStepValid = viewModel.isCurrentStepValid,
        warningText = viewModel.warningText,
        isSubmitting = viewModel.isSubmitting,
        continueLabel = if (viewModel.step == FINAL_VERIFY_STEP_COUNT) "Submit" else "Continue",
        onContinue = {
            if (viewModel.step == FINAL_VERIFY_STEP_COUNT) {
                scope.launch {
                    val issue = viewModel.submit()
                    if (issue != null) {
                        toast.show(if (viewModel.confirmed == true) "Finding verified and closed." else "Finding reopened — officer notified.")
                        onDone(issue.id)
                    }
                }
            } else {
                viewModel.next()
            }
        },
    ) {
        when (viewModel.step) {
            1 -> LookUpIssueStep(viewModel)
            2 -> ConfirmResolutionStep(viewModel) { activeModal = WizardModal.Voice }
            3 -> Column {
                DatePickerField("Date of Verification", viewModel.date, { viewModel.date = it }, Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                GpsCaptureStep(viewModel.gps, onOpenGpsModal = { activeModal = WizardModal.Gps })
            }
            4 -> Column {
                PhotoCaptureStep(
                    label = "Selfie", hint = "Confirms the verifier's presence — required.",
                    photoPath = viewModel.selfiePhotoPath, icon = Icons.Filled.Person,
                    onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = true, label = "Selfie") },
                )
                Spacer(Modifier.height(12.dp))
                PhotoCaptureStep(
                    label = "MOV Photo", hint = "Capture a photo of the resolved condition.",
                    photoPath = viewModel.movPhotoPath, icon = Icons.Filled.CameraAlt,
                    onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = false, label = "MOV Photo") },
                )
            }
            5 -> ReviewStep(viewModel)
        }
        if (viewModel.submitError != null) {
            Text(viewModel.submitError.orEmpty(), color = TpmColors.Error, style = MaterialTheme.typography.bodySmall)
        }
    }

    when (val modal = activeModal) {
        WizardModal.Gps -> GpsCaptureModal(onDismiss = { activeModal = null }, onUseLocation = { viewModel.gps = it; activeModal = null })
        WizardModal.Voice -> VoiceInputModal(onDismiss = { activeModal = null }, onUseText = { viewModel.comment = it; activeModal = null })
        is WizardModal.Camera -> CameraCaptureModal(
            title = modal.label,
            useFrontCamera = modal.useFrontCamera,
            onDismiss = { activeModal = null },
            onPhotoCaptured = { path ->
                if (modal.useFrontCamera) viewModel.selfiePhotoPath = path else viewModel.movPhotoPath = path
                activeModal = null
            },
        )
        null -> {}
    }
}

@Composable
private fun LookUpIssueStep(vm: FinalVerifyWizardViewModel) {
    val repository = LocalAppRepository.current
    val pending by repository.observePendingVerification().collectAsState(initial = emptyList())

    Column {
        Row(modifier = Modifier.fillMaxWidth()) {
            TpmTextField(
                label = "Finding ID", value = vm.lookupId, onValueChange = { vm.lookupId = it },
                placeholder = "e.g. KT-DAU-MAJ-OTP-26001", modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(8.dp))
        TpmButton(text = "Search", icon = Icons.Filled.Search, onClick = { vm.search() }, variant = TpmButtonVariant.Secondary, blueprint = true)
        if (vm.lookupError != null) {
            Text(vm.lookupError.orEmpty(), color = TpmColors.Error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(16.dp))
        Text("Resolved — Pending Verification", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        pending.forEach { issue ->
            val sla = computeSla(issue)
            val meta = statusMeta(issue.status)
            IssueRow(
                issueId = issue.id,
                line2 = "${issue.category} · ${issue.locationLabel}",
                statusLabel = meta.label,
                statusVariant = meta.variant,
                overdue = sla.overdue,
                onClick = { vm.pickIssue(issue) },
            )
        }

        vm.foundIssue?.driResponse?.let { response ->
            Spacer(Modifier.height(16.dp))
            Text("Officer's Response", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                Text(response.action, style = MaterialTheme.typography.bodyMedium)
                Text("${response.name} · ${response.designation}", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
        }
    }
}

@Composable
private fun ConfirmResolutionStep(vm: FinalVerifyWizardViewModel, onOpenVoice: () -> Unit) {
    Column {
        Text(
            "Did the officer's corrective action adequately resolve the reported finding?",
            style = MaterialTheme.typography.bodyMedium,
        )
        TpmSegmentedControl(
            options = listOf(true, false),
            selected = vm.confirmed,
            onSelect = { vm.confirmed = it },
            labelFor = { if (it) "Yes" else "No" },
            modifier = Modifier.fillMaxWidth(),
        )
        TpmTextField(
            label = if (vm.confirmed == false) "Why does the finding remain unresolved?" else "Verification Comment",
            value = vm.comment,
            onValueChange = { vm.comment = it },
            singleLine = false,
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
            placeholder = if (vm.confirmed == true) "e.g. Finding resolved as stated." else null
        )
        TpmButton(text = "Speak instead", onClick = onOpenVoice, variant = TpmButtonVariant.Ghost)
    }
}

@Composable
private fun ReviewStep(vm: FinalVerifyWizardViewModel) {
    Column {
        TpmCard(modifier = Modifier.fillMaxWidth()) {
            ReviewRow("Finding", vm.foundIssue?.id.orEmpty())
            ReviewRow("Outcome", if (vm.confirmed == true) "Confirmed Resolved — Verified / Closed" else "Not Resolved — Reopened")
            if (vm.confirmed == false) ReviewRow("Comment", vm.comment)
            ReviewRow("Date", vm.date.toString())
            ReviewRow("GPS", vm.gps?.let { "${it.lat}, ${it.lng} (±${it.accuracyMeters}m)" }.orEmpty())
            ReviewRow("Selfie", if (vm.selfiePhotoPath != null) "Captured" else "Not captured")
            ReviewRow("MOV Photo", if (vm.movPhotoPath != null) "Captured" else "Not captured")
        }
        if (vm.confirmed == false) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Reopening will notify the original officer and return this finding to their response queue.",
                style = MaterialTheme.typography.bodySmall,
                color = TpmColors.Accent700,
            )
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
