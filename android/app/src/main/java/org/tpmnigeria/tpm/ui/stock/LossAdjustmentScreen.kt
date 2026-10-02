package org.tpmnigeria.tpm.ui.stock

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
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
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.domain.LedgerPhoto
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.domain.StockPosition
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmSegmentedControl
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel
import java.time.LocalDate
import java.util.UUID

private val LOSS_STEPS = listOf("What happened", "Reason and evidence", "Review")

enum class LossType(val dbValue: String, val label: String) {
    Damaged("loss_damaged", "Damaged"),
    Expired("loss_expired", "Expired"),
    Other("loss_other", "Other loss"),
    Adjustment("adjustment", "Adjustment (correction)"),
}

/**
 * Record Loss / Adjustment (brief §8): damaged, expired or otherwise lost sachets, or a signed
 * correction — always with a reason; adjustments wait for supervisor confirmation. 3 steps.
 */
class LossAdjustmentViewModel(private val stock: StockRepository, val facilityId: String, private val appContext: Context) : ViewModel() {
    private val localId = UUID.randomUUID().toString()
    var step by mutableStateOf(1)
        private set
    var type by mutableStateOf<LossType?>(null)
    var lotId by mutableStateOf<String?>(null)
    var date by mutableStateOf(LocalDate.now())
    var cartons by mutableStateOf("")
    var loose by mutableStateOf("")
    /** Adjustments only: true = stock to remove, false = stock to add. */
    var decrease by mutableStateOf(true)
    var reason by mutableStateOf("")
    var photoPath by mutableStateOf<String?>(null)
    var isSubmitting by mutableStateOf(false)
        private set

    fun magnitude(u: Int) = org.tpmnigeria.tpm.domain.toSachets(cartons.toIntOrNull() ?: 0, loose.toIntOrNull() ?: 0, u)
    fun signed(u: Int) = if (type == LossType.Adjustment && !decrease) magnitude(u) else if (type == LossType.Adjustment) -magnitude(u) else magnitude(u)

    fun isValid(u: Int): Boolean = when (step) {
        1 -> type != null && lotId != null && magnitude(u) > 0 && !date.isAfter(LocalDate.now())
        2 -> reason.trim().length >= 5
        else -> true
    }

    fun warning(): String = when (step) {
        1 -> "Choose the type, the lot, a quantity above zero and a date that isn't in the future."
        2 -> "Explain what happened (at least a few words)."
        else -> ""
    }

    fun next() { step = (step + 1).coerceAtMost(LOSS_STEPS.size) }
    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(u: Int): Boolean {
        val t = type ?: return false
        if (isSubmitting) return false
        isSubmitting = true
        return try {
            stock.submit(
                LedgerSubmissions.loss(
                    localId = localId, facilityId = facilityId, date = date.toString(), lossType = t.dbValue,
                    line = org.tpmnigeria.tpm.domain.LedgerLine(lotId = lotId, quantity = signed(u)), reason = reason,
                    deviceId = androidDeviceId(appContext), photos = listOfNotNull(photoPath?.let { LedgerPhoto(it, "loss_evidence") }),
                    summary = "${t.label}: ${"%+,d".format(if (t == LossType.Adjustment) signed(u) else -signed(u))} sachets",
                ),
            )
            true
        } finally {
            isSubmitting = false
        }
    }
}

@Composable
fun LossAdjustmentScreen(facilityId: String, onDone: () -> Unit, onExit: () -> Unit) {
    val stock = LocalStockRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val vm = rememberWizardViewModel { LossAdjustmentViewModel(stock, facilityId, context.applicationContext) }
    val u by stock.observeUnitsPerCarton().collectAsState(initial = StockRepository.DEFAULT_UNITS_PER_CARTON)
    val lots by stock.observeLots().collectAsState(initial = emptyList())
    val position by remember(facilityId) { stock.observeStock(facilityId) }.collectAsState(initial = StockPosition(emptyList(), 0, 0))
    var camera by remember { mutableStateOf(false) }
    val heldLots = lots.filter { lot -> position.lots.any { it.lotId == lot.id && it.projected != 0 } }
    val onHand = position.lots.firstOrNull { it.lotId == vm.lotId }?.projected

    val handleBack = { if (!vm.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = vm.step, totalSteps = LOSS_STEPS.size, stepLabel = LOSS_STEPS[vm.step - 1],
        isStepValid = vm.isValid(u), warningText = vm.warning(), isSubmitting = vm.isSubmitting,
        continueLabel = if (vm.step == LOSS_STEPS.size) "Record" else "Continue",
        onContinue = {
            if (vm.step < LOSS_STEPS.size) vm.next() else scope.launch {
                if (vm.submit(u)) {
                    toast.show("Saved — it will sync when you're online.")
                    onDone()
                }
            }
        },
    ) {
        when (vm.step) {
            1 -> {
                TpmDropdown(label = "Type", selected = vm.type, options = LossType.entries, labelFor = { it.label }, onSelect = { vm.type = it })
                TpmDropdown(label = "Lot", selected = heldLots.firstOrNull { it.id == vm.lotId }, options = heldLots,
                    labelFor = { lotLabel(it.lotNo, it.expiryDate) }, onSelect = { vm.lotId = it.id }, emptyLabel = "No stock recorded at this facility")
                if (vm.type == LossType.Adjustment) {
                    TpmSegmentedControl(
                        options = listOf(true, false),
                        selected = vm.decrease,
                        onSelect = { vm.decrease = it },
                        labelFor = { if (it) "Remove stock" else "Add stock" },
                    )
                }
                QuantityInput(label = "Quantity", cartons = vm.cartons, loose = vm.loose, onCartons = { vm.cartons = it }, onLoose = { vm.loose = it }, unitsPerCarton = u)
                if (onHand != null && vm.type != LossType.Adjustment && vm.magnitude(u) > onHand) {
                    Text("More than the ${fmt(onHand)} sachets of this lot on hand as far as this phone knows.",
                        style = MaterialTheme.typography.bodySmall, color = TpmColors.Accent800)
                }
                DatePickerField(label = "Date", date = vm.date, onDateChange = { vm.date = it })
            }
            2 -> {
                TpmTextField(label = "Reason", value = vm.reason, onValueChange = { vm.reason = it }, singleLine = false, minLines = 3,
                    placeholder = "e.g. cartons soaked by a roof leak; counted 12 sachets torn")
                PhotoCaptureStep(label = "Evidence photo", hint = "Optional — the damaged stock or the stock card entry.",
                    photoPath = vm.photoPath, icon = Icons.Filled.CameraAlt, onOpenCamera = { camera = true })
                if (vm.type == LossType.Adjustment) {
                    Text("Adjustments are confirmed by your supervisor on their next visit.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                }
            }
            3 -> TpmCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    val lot = lots.firstOrNull { it.id == vm.lotId }
                    ReviewRow("Type", vm.type?.label.orEmpty())
                    ReviewRow("Lot", lotLabel(lot?.lotNo, lot?.expiryDate))
                    ReviewRow("Change to stock", "${"%+,d".format(if (vm.type == LossType.Adjustment) vm.signed(u) else -vm.magnitude(u))} sachets")
                    ReviewRow("Date", vm.date.toString())
                    ReviewRow("Reason", vm.reason.trim())
                    ReviewRow("Photo", if (vm.photoPath != null) "Captured" else "None")
                }
            }
        }
    }

    if (camera) {
        CameraCaptureModal(title = "Evidence", useFrontCamera = false, onDismiss = { camera = false },
            onPhotoCaptured = { vm.photoPath = it; camera = false })
    }
}
