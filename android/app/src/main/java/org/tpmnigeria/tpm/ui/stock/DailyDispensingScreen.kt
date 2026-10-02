package org.tpmnigeria.tpm.ui.stock

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.domain.LedgerPhoto
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel
import java.time.LocalDate
import java.util.UUID

/**
 * Daily Dispensing (OTP sites, brief §8): the day's tallies from the OTP register — totals only,
 * never a row per child (brief §10). One screen. One entry per day; the server allocates the
 * sachets to lots. The register photo is optional and only with names covered (brief §12.5).
 */
class DailyDispensingViewModel(private val stock: StockRepository, val facilityId: String, private val appContext: Context) : ViewModel() {
    private val localId = UUID.randomUUID().toString()
    var date by mutableStateOf(LocalDate.now())
    var newAdmissions by mutableStateOf("")
    var childrenSeen by mutableStateOf("")
    var prescribed by mutableStateOf("")
    var dispensed by mutableStateOf("")
    var photoPath by mutableStateOf<String?>(null)
    var namesCovered by mutableStateOf(false)
    var alreadyRecorded by mutableStateOf(false)
        private set
    var isSubmitting by mutableStateOf(false)
        private set

    suspend fun checkDate() { alreadyRecorded = stock.isDispensingRecorded(facilityId, date) }

    private fun n(s: String) = s.toIntOrNull()
    val warning: String? get() = when {
        date.isAfter(LocalDate.now()) -> "The date can't be in the future."
        alreadyRecorded -> "Dispensing for $date is already recorded. Only one entry per day."
        listOf(newAdmissions, childrenSeen, prescribed, dispensed).any { n(it) == null } -> "Enter all four tallies from the register (0 if none)."
        n(newAdmissions)!! > n(childrenSeen)!! -> "New admissions can't be more than children seen."
        photoPath != null && !namesCovered -> "Confirm that child and caregiver names are covered in the photo."
        else -> null
    }

    suspend fun submit(): Boolean {
        if (warning != null || isSubmitting) return false
        isSubmitting = true
        return try {
            stock.submit(
                LedgerSubmissions.dispensing(
                    localId = localId, facilityId = facilityId, date = date.toString(),
                    newAdmissions = n(newAdmissions)!!, childrenSeen = n(childrenSeen)!!,
                    prescribed = n(prescribed)!!, dispensed = n(dispensed)!!, deviceId = androidDeviceId(appContext),
                    photos = listOfNotNull(photoPath?.let { LedgerPhoto(it, "register_page") }),
                    summary = "Dispensed ${fmt(n(dispensed)!!)} sachets on $date",
                ),
            )
            true
        } finally {
            isSubmitting = false
        }
    }
}

@Composable
fun DailyDispensingScreen(facilityId: String, onDone: () -> Unit, onExit: () -> Unit) {
    val stock = LocalStockRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val vm = rememberWizardViewModel { DailyDispensingViewModel(stock, facilityId, context.applicationContext) }
    var camera by remember { mutableStateOf(false) }
    LaunchedEffect(vm.date) { vm.checkDate() }

    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)

    WizardScaffold(
        stepIndex = 1, totalSteps = 1, stepLabel = "Daily dispensing",
        isStepValid = vm.warning == null, warningText = vm.warning.orEmpty(), isSubmitting = vm.isSubmitting,
        continueLabel = "Record dispensing",
        onContinue = {
            scope.launch {
                if (vm.submit()) {
                    toast.show("Dispensing saved — it will sync when you're online.")
                    onDone()
                }
            }
        },
    ) {
        Text("Copy the day's totals from the OTP register. No names or per-child details.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        DatePickerField(label = "Date", date = vm.date, onDateChange = { vm.date = it })
        NumberField(label = "New admissions", value = vm.newAdmissions, onValueChange = { vm.newAdmissions = it })
        NumberField(label = "Children seen (incl. new admissions)", value = vm.childrenSeen, onValueChange = { vm.childrenSeen = it })
        NumberField(label = "Sachets prescribed", value = vm.prescribed, onValueChange = { vm.prescribed = it })
        NumberField(label = "Sachets dispensed", value = vm.dispensed, onValueChange = { vm.dispensed = it })
        val p = vm.prescribed.toIntOrNull()
        val d = vm.dispensed.toIntOrNull()
        if (p != null && d != null && p > 0 && d != p) {
            Text(
                if (d < p) "${fmt(p - d)} sachets fewer than prescribed — check the register if that's not right."
                else "${fmt(d - p)} sachets more than prescribed — check the register if that's not right.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.Accent800,
            )
        }
        PhotoCaptureStep(
            label = "Register page photo", hint = "Optional. Cover every child and caregiver name before taking it.",
            photoPath = vm.photoPath, icon = Icons.Filled.MenuBook, onOpenCamera = { camera = true },
        )
        if (vm.photoPath != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = vm.namesCovered, onCheckedChange = { vm.namesCovered = it })
                Text("Child and caregiver names are covered in this photo", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }

    if (camera) {
        CameraCaptureModal(title = "Register page (names covered)", useFrontCamera = false, onDismiss = { camera = false },
            onPhotoCaptured = { vm.photoPath = it; vm.namesCovered = false; camera = false })
    }
}
