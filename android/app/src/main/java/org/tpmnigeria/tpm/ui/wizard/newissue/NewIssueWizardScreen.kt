package org.tpmnigeria.tpm.ui.wizard.newissue

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Person
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
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.local.CategoryRefEntity
import org.tpmnigeria.tpm.data.local.LgaRefEntity
import org.tpmnigeria.tpm.data.local.StateRefEntity
import org.tpmnigeria.tpm.data.local.WardRefEntity
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
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
import org.tpmnigeria.tpm.ui.wizard.common.GpsCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardModal
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel

/** README §5 Register New Issue — 6-step wizard. */
@Composable
fun NewIssueWizardScreen(onDone: (issueId: String) -> Unit, onExit: () -> Unit) {
    val repository = LocalAppRepository.current
    val referenceRepository = LocalReferenceRepository.current
    val session = LocalAppSession.current
    val viewModel = rememberWizardViewModel { NewIssueWizardViewModel(repository, referenceRepository, session) }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    var activeModal by remember { mutableStateOf<WizardModal?>(null) }

    val handleBack = { if (!viewModel.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = viewModel.step,
        totalSteps = NEW_ISSUE_STEP_LABELS.size,
        stepLabel = NEW_ISSUE_STEP_LABELS[viewModel.step - 1],
        isStepValid = viewModel.isCurrentStepValid,
        warningText = viewModel.warningText,
        isSubmitting = viewModel.isSubmitting,
        continueLabel = if (viewModel.step == NEW_ISSUE_STEP_LABELS.size) "Submit" else "Continue",
        onContinue = {
            if (viewModel.step == NEW_ISSUE_STEP_LABELS.size) {
                scope.launch {
                    val issue = viewModel.submit()
                    if (issue != null) {
                        toast.show("Finding ${issue.id} registered.")
                        onDone(issue.id)
                    }
                }
            } else {
                viewModel.next()
            }
        },
    ) {
        when (viewModel.step) {
            1 -> LocationStep(viewModel)
            2 -> IssueDetailsStep(viewModel) { activeModal = WizardModal.Voice }
            3 -> GpsCaptureStep(viewModel.gps, onOpenGpsModal = { activeModal = WizardModal.Gps })
            4 -> PhotoCaptureStep(
                label = "MOV Photo", hint = "Capture a photo of the affected site or commodity as evidence.",
                photoPath = viewModel.movPhotoPath, icon = Icons.Filled.CameraAlt,
                onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = false, label = "MOV Photo") },
            )
            5 -> PhotoCaptureStep(
                label = "Selfie", hint = "Take a selfie to confirm your on-site presence.",
                photoPath = viewModel.selfiePhotoPath, icon = Icons.Filled.Person,
                onOpenCamera = { activeModal = WizardModal.Camera(useFrontCamera = true, label = "Selfie") },
            )
            6 -> ReviewStep(viewModel)
        }
        if (viewModel.submitError != null) {
            Text(viewModel.submitError.orEmpty(), color = TpmColors.Error, style = MaterialTheme.typography.bodySmall)
        }
    }

    when (val modal = activeModal) {
        WizardModal.Gps -> GpsCaptureModal(
            onDismiss = { activeModal = null },
            onUseLocation = { viewModel.gps = it; activeModal = null },
        )
        WizardModal.Voice -> VoiceInputModal(
            onDismiss = { activeModal = null },
            onUseText = { viewModel.description = it; activeModal = null },
        )
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
private fun LocationStep(vm: NewIssueWizardViewModel) {
    val referenceRepository = LocalReferenceRepository.current
    val states by referenceRepository.observeStates().collectAsState(initial = emptyList())
    val lgas by remember(vm.selectedState) {
        vm.selectedState?.let { referenceRepository.observeLgas(it.id) } ?: flowOf(emptyList())
    }.collectAsState(initial = emptyList())
    val wards by remember(vm.selectedLga) {
        vm.selectedLga?.let { referenceRepository.observeWards(it.id) } ?: flowOf(emptyList())
    }.collectAsState(initial = emptyList())
    // Settlement and Activity Site are independent siblings scoped directly to the selected Ward
    // — not chained through each other (see DECISIONS.md #8) — so both load as soon as a Ward is
    // picked. They're merged into a single picker here purely at the UI layer: field staff search
    // one combined list instead of two separate required dropdowns, plus a trailing "Other" entry
    // for a place that isn't in the reference list yet (see supabase/migrations/0020_issue_location_other.sql).
    val settlements by remember(vm.selectedWard) {
        vm.selectedWard?.let { referenceRepository.observeSettlements(it.id) } ?: flowOf(emptyList())
    }.collectAsState(initial = emptyList())
    val activitySites by remember(vm.selectedWard) {
        vm.selectedWard?.let { referenceRepository.observeActivitySites(it.id) } ?: flowOf(emptyList())
    }.collectAsState(initial = emptyList())
    val locationOptions = remember(settlements, activitySites) {
        settlements.map { LocationOption.Settlement(it) } + activitySites.map { LocationOption.Site(it) } + listOf(LocationOption.Other)
    }

    Column {
        TpmDropdown<StateRefEntity>("State", vm.selectedState, states, vm::onStateChange, Modifier.fillMaxWidth(), labelFor = { it.name })
        TpmDropdown<LgaRefEntity>("LGA", vm.selectedLga, lgas, vm::onLgaChange, Modifier.fillMaxWidth(), enabled = vm.selectedState != null, labelFor = { it.name })
        TpmDropdown<WardRefEntity>("Ward", vm.selectedWard, wards, vm::onWardChange, Modifier.fillMaxWidth(), enabled = vm.selectedLga != null, labelFor = { it.name })
        TpmDropdown<LocationOption>(
            "Settlement / Activity Site", vm.selectedLocation, locationOptions, vm::onLocationChange, Modifier.fillMaxWidth(),
            enabled = vm.selectedWard != null, labelFor = { it.label },
            emptyLabel = "No settlements or activity sites available for this Ward.",
        )
        if (vm.selectedLocation == LocationOption.Other) {
            TpmTextField(
                label = "Location name",
                value = vm.otherLocationText,
                onValueChange = { vm.otherLocationText = it },
                placeholder = "Type the settlement or activity site name",
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun IssueDetailsStep(vm: NewIssueWizardViewModel, onOpenVoice: () -> Unit) {
    val referenceRepository = LocalReferenceRepository.current
    val categories by referenceRepository.observeCategories().collectAsState(initial = emptyList())

    Column {
        TpmDropdown<CategoryRefEntity>("Sector", vm.selectedCategory, categories, { vm.selectedCategory = it }, Modifier.fillMaxWidth(), labelFor = { it.name })
        Text("Severity", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        TpmSegmentedControl(
            options = listOf(Severity.High, Severity.Medium, Severity.Low),
            selected = vm.severity,
            onSelect = { vm.severity = it },
            labelFor = { it.name },
            modifier = Modifier.fillMaxWidth(),
        )
        TpmTextField(
            label = "Description", value = vm.description, onValueChange = { vm.description = it },
            singleLine = false, minLines = 4, modifier = Modifier.fillMaxWidth(),
        )
        TpmButton(text = "Speak instead", onClick = onOpenVoice, variant = TpmButtonVariant.Ghost)
        DatePickerField(
            label = "Date of Registration",
            date = vm.date,
            onDateChange = { vm.date = it },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun ReviewStep(vm: NewIssueWizardViewModel) {
    TpmCard(modifier = Modifier.fillMaxWidth()) {
        ReviewRow(
            "Location",
            listOfNotNull(
                when (val loc = vm.selectedLocation) {
                    is LocationOption.Settlement -> loc.entity.name
                    is LocationOption.Site -> loc.entity.name
                    LocationOption.Other -> vm.otherLocationText.ifBlank { null }
                    null -> null
                },
                vm.selectedWard?.name, vm.selectedLga?.name, vm.selectedState?.name,
            ).joinToString(", "),
        )
        ReviewRow("Sector", vm.selectedCategory?.name.orEmpty())
        ReviewRow("Severity", vm.severity?.name.orEmpty())
        ReviewRow("Description", vm.description)
        ReviewRow("Date", vm.date.toString())
        ReviewRow("GPS", vm.gps?.let { "${it.lat}, ${it.lng} (±${it.accuracyMeters}m)" }.orEmpty())
        ReviewRow("MOV Photo", if (vm.movPhotoPath != null) "Captured" else "Not captured")
        ReviewRow("Selfie", if (vm.selfiePhotoPath != null) "Captured" else "Not captured")
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
