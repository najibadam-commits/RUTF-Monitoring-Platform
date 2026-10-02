package org.tpmnigeria.tpm.ui.wizard.driresponse

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
import org.tpmnigeria.tpm.domain.DESIGNATION_OPTIONS
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
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmSegmentedControl
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.components.modal.GpsCaptureModal
import org.tpmnigeria.tpm.ui.components.modal.VoiceInputModal
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import org.tpmnigeria.tpm.ui.wizard.common.GpsCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardModal
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel

/** README §6 DRI Response — 6-step wizard. */
@Composable
fun DriRespondWizardScreen(initialIssueId: String?, onDone: (issueId: String) -> Unit, onExit: () -> Unit) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val viewModel = rememberWizardViewModel { DriRespondWizardViewModel(repository, session, initialIssueId) }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    var activeModal by remember { mutableStateOf<WizardModal?>(null) }

    val handleBack = { if (!viewModel.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = viewModel.step,
        totalSteps = DRI_RESPOND_STEP_COUNT,
        stepLabel = DRI_RESPOND_STEP_LABELS[viewModel.step - 1],
        isStepValid = viewModel.isCurrentStepValid,
        warningText = viewModel.warningText,
        isSubmitting = viewModel.isSubmitting,
        continueLabel = if (viewModel.step == DRI_RESPOND_STEP_COUNT) "Submit" else "Continue",
        onContinue = {
            if (viewModel.step == DRI_RESPOND_STEP_COUNT) {
                scope.launch {
                    val issue = viewModel.submit()
                    if (issue != null) {
                        toast.show(if (viewModel.resolved == true) "Response submitted — Supervisor notified for verification." else "Response submitted.")
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
            2 -> ResponseStep(viewModel) { activeModal = WizardModal.Voice }
            3 -> Column {
                DatePickerField("Date of Action", viewModel.date, { viewModel.date = it }, Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                GpsCaptureStep(viewModel.gps, onOpenGpsModal = { activeModal = WizardModal.Gps })
            }
            4 -> StatusStep(viewModel)
            5 -> Column {
                PhotoCaptureStep(
                    label = "MOV Photo", hint = "Capture evidence of the corrective action taken.",
                    photoPath = viewModel.movPhotoPath, icon = Icons.Filled.CameraAlt,
                    onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = false, label = "MOV Photo") },
                )
                Spacer(Modifier.height(12.dp))
                PhotoCaptureStep(
                    label = "Selfie", hint = "Confirm your on-site presence.",
                    photoPath = viewModel.selfiePhotoPath, icon = Icons.Filled.Person,
                    onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = true, label = "Selfie") },
                )
            }
            6 -> ReviewStep(viewModel)
        }
        if (viewModel.submitError != null) {
            Text(viewModel.submitError.orEmpty(), color = TpmColors.Accent800, style = MaterialTheme.typography.bodySmall)
        }
    }

    when (val modal = activeModal) {
        WizardModal.Gps -> GpsCaptureModal(onDismiss = { activeModal = null }, onUseLocation = { viewModel.gps = it; activeModal = null })
        WizardModal.Voice -> VoiceInputModal(onDismiss = { activeModal = null }, onUseText = { viewModel.action = it; activeModal = null })
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
private fun LookUpIssueStep(vm: DriRespondWizardViewModel) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val currentUser by session.currentUser.collectAsState()
    // observeAssignableForDri() only filters by status (new/ongoing/reopened) — it does not
    // filter by assignee, so every signed-in DRI was seeing every OTHER DRI's already-assigned
    // issues here too, not just their own or the unassigned pool. The server-side RPCs already
    // reject a response submitted for an issue that isn't this DRI's (submit_dri_response's
    // "Only the assigned DRI" guard), so this was never an actual security hole — just a
    // confusing list (and a wasted round trip: pick an issue, fill out the whole wizard, then get
    // a permission error on submit) rather than never showing it in the first place.
    val assignable by repository.observeAssignableForDri().collectAsState(initial = emptyList())
    val visibleToThisDri = assignable.filter { it.assignedDriId == null || it.assignedDriId == currentUser?.id }

    Column {
        Row(modifier = Modifier.fillMaxWidth()) {
            TpmTextField(
                label = "Finding ID", value = vm.lookupId, onValueChange = { vm.lookupId = it },
                placeholder = "e.g. KMC-NAS-WSF-26-NI001", modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(8.dp))
        TpmButton(text = "Search", icon = Icons.Filled.Search, onClick = { vm.search() }, variant = TpmButtonVariant.Secondary, blueprint = true)
        if (vm.lookupError != null) {
            Text(vm.lookupError.orEmpty(), color = TpmColors.Accent800, style = MaterialTheme.typography.bodySmall)
        }
        if (vm.foundIssue != null) {
            Text("Found: ${vm.foundIssue!!.id}", style = MaterialTheme.typography.bodyMedium, color = TpmColors.Accent700)
        }

        Spacer(Modifier.height(16.dp))
        Text("Assignable Findings", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        visibleToThisDri.forEach { issue ->
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
    }
}

@Composable
private fun ResponseStep(vm: DriRespondWizardViewModel, onOpenVoice: () -> Unit) {
    Column {
        TpmDropdown("Designation", vm.designation, DESIGNATION_OPTIONS, { vm.designation = it }, Modifier.fillMaxWidth())
        TpmTextField(
            label = "Action Taken", value = vm.action, onValueChange = { vm.action = it },
            singleLine = false, minLines = 4, modifier = Modifier.fillMaxWidth(),
        )
        TpmButton(text = "Speak instead", onClick = onOpenVoice, variant = TpmButtonVariant.Ghost)
    }
}

@Composable
private fun StatusStep(vm: DriRespondWizardViewModel) {
    Column {
        Text("Current Finding Status", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        Spacer(Modifier.height(TpmSpacing.space2))
        TpmSegmentedControl(
            options = listOf(false, true),
            selected = vm.resolved,
            onSelect = { vm.resolved = it },
            labelFor = { if (it) "Resolved" else "Ongoing" },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            if (vm.resolved == true) "Resolved routes this finding to the Supervisor for final verification."
            else if (vm.resolved == false) "Ongoing keeps this finding open and visible until it's resolved."
            else "Select whether the finding is still Ongoing or has been Resolved.",
            style = MaterialTheme.typography.bodySmall,
            color = TpmColors.TextMuted,
        )
    }
}

@Composable
private fun ReviewStep(vm: DriRespondWizardViewModel) {
    Column {
        TpmCard(modifier = Modifier.fillMaxWidth()) {
            ReviewRow("Finding", vm.foundIssue?.id.orEmpty())
            ReviewRow("Designation", vm.designation)
            ReviewRow("Action Taken", vm.action)
            ReviewRow("Date", vm.date.toString())
            ReviewRow("GPS", vm.gps?.let { "${it.lat}, ${it.lng} (±${it.accuracyMeters}m)" }.orEmpty())
            ReviewRow("Status", if (vm.resolved == true) "Resolved" else "Ongoing")
            ReviewRow("MOV Photo", if (vm.movPhotoPath != null) "Captured" else "Not captured")
            ReviewRow("Selfie", if (vm.selfiePhotoPath != null) "Captured" else "Not captured")
        }
        if (vm.resolved == true) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Marking this Resolved will notify the original Supervisor to perform final verification.",
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

