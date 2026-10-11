package org.tpmnigeria.tpm.ui.stock

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.data.local.FacilityRefEntity
import org.tpmnigeria.tpm.domain.LedgerPhoto
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.domain.StockPosition
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
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

private val ISSUE_STEPS = listOf("Receiving facility", "Lots and quantities", "Issue voucher photo", "Review")

/**
 * Issue Stock (stores only, brief §8): send stock to a facility this store supplies. Creates the
 * transfer the receiving facility then confirms with Receive Stock. 4 steps; offline-capable.
 */
class IssueStockViewModel(private val stock: StockRepository, val facilityId: String, private val appContext: Context) : ViewModel() {
    private val localId = UUID.randomUUID().toString()
    private var nextKey = 1

    var step by mutableStateOf(1)
        private set
    var toFacility by mutableStateOf<FacilityRefEntity?>(null)
    var date by mutableStateOf(LocalDate.now())
    var voucherNo by mutableStateOf("")
    val lines = mutableStateListOf(LineDraft(nextKey++))
    var photoPath by mutableStateOf<String?>(null)
    var isSubmitting by mutableStateOf(false)
        private set

    fun addLine() { lines += LineDraft(nextKey++) }
    fun update(d: LineDraft) { lines.indexOfFirst { it.key == d.key }.takeIf { it >= 0 }?.let { lines[it] = d } }
    fun remove(d: LineDraft) { lines.removeAll { it.key == d.key } }

    fun isValid(u: Int): Boolean = when (step) {
        1 -> toFacility != null && !date.isAfter(LocalDate.now())
        2 -> lines.isNotEmpty() && lines.all { it.lotId != null && it.sachets(u) > 0 } && lines.map { it.lotId }.distinct().size == lines.size
        else -> true
    }

    fun warning(): String = when (step) {
        1 -> if (toFacility == null) "Choose the facility you're issuing to." else "The date can't be in the future."
        2 -> "Each line needs a lot (once each) and a quantity above zero."
        else -> ""
    }

    fun next() { step = (step + 1).coerceAtMost(ISSUE_STEPS.size) }
    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(u: Int): Boolean {
        val to = toFacility ?: return false
        if (isSubmitting) return false
        isSubmitting = true
        return try {
            val ledgerLines = lines.map { it.toLine(u) }
            stock.submit(
                LedgerSubmissions.issue(
                    localId = localId, facilityId = facilityId, toFacilityId = to.id, date = date.toString(), lines = ledgerLines,
                    documentNo = voucherNo, deviceId = androidDeviceId(appContext),
                    photos = listOfNotNull(photoPath?.let { LedgerPhoto(it, "waybill") }),
                    summary = "Issued ${fmt(ledgerLines.sumOf { it.quantity })} sachets to ${to.name}",
                ),
            )
            true
        } finally {
            isSubmitting = false
        }
    }
}

@Composable
fun IssueStockScreen(facilityId: String, onDone: () -> Unit, onExit: () -> Unit) {
    val stock = LocalStockRepository.current
    val references = LocalReferenceRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val vm = rememberWizardViewModel { IssueStockViewModel(stock, facilityId, context.applicationContext) }
    val u by stock.observeUnitsPerCarton().collectAsState(initial = StockRepository.DEFAULT_UNITS_PER_CARTON)
    val lots by stock.observeLots().collectAsState(initial = emptyList())
    val position by remember(facilityId) { stock.observeStock(facilityId) }.collectAsState(initial = StockPosition(emptyList(), 0, 0))
    val supplied by remember(facilityId) { references.observeFacilitiesSuppliedBy(facilityId) }.collectAsState(initial = emptyList())
    var camera by remember { mutableStateOf(false) }

    // Only lots this store actually holds.
    val available = position.lots.filter { it.lotId != null && it.projected > 0 }
    val availableLots = lots.filter { lot -> available.any { it.lotId == lot.id } }

    val handleBack = { if (!vm.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = vm.step, totalSteps = ISSUE_STEPS.size, stepLabel = ISSUE_STEPS[vm.step - 1],
        isStepValid = vm.isValid(u), warningText = vm.warning(), isSubmitting = vm.isSubmitting,
        continueLabel = if (vm.step == ISSUE_STEPS.size) "Record issue" else "Continue",
        onContinue = {
            if (vm.step < ISSUE_STEPS.size) vm.next() else scope.launch {
                if (vm.submit(u)) {
                    toast.show("Issue saved — the transfer is created when it syncs.")
                    onDone()
                }
            }
        },
    ) {
        when (vm.step) {
            1 -> {
                TpmDropdown(
                    label = "Issue to", selected = vm.toFacility, options = supplied.sortedBy { it.name },
                    labelFor = { it.name }, onSelect = { vm.toFacility = it },
                    emptyLabel = "This store supplies no facilities (as of the last sync)",
                )
                DatePickerField(label = "Date issued", date = vm.date, onDateChange = { vm.date = it })
                TpmTextField(label = "Issue voucher number (optional)", value = vm.voucherNo, onValueChange = { vm.voucherNo = it })
            }
            2 -> {
                vm.lines.forEach { line ->
                    LotLineEditor(
                        draft = line.copy(reference = null), onChange = vm::update, lots = availableLots, unitsPerCarton = u,
                        quantityLabel = "Quantity to issue", allowNewLot = false,
                        onRemove = if (vm.lines.size > 1) ({ vm.remove(line) }) else null,
                    )
                    val onHand = available.firstOrNull { it.lotId == line.lotId }?.projected
                    if (onHand != null && line.sachets(u) > onHand) {
                        Text("Only ${fmt(onHand)} sachets of this lot on hand as far as this phone knows.",
                            style = MaterialTheme.typography.bodySmall, color = TpmColors.Warning)
                    }
                }
                if (vm.lines.size < availableLots.size) TpmButton(text = "Add another lot", onClick = vm::addLine, variant = TpmButtonVariant.Secondary, fullWidth = true)
            }
            3 -> PhotoCaptureStep(
                label = "Issue voucher photo", hint = "Optional — the signed issue voucher or waybill.",
                photoPath = vm.photoPath, icon = Icons.Filled.Description, onOpenCamera = { camera = true },
            )
            4 -> TpmCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    ReviewRow("Issue to", vm.toFacility?.name.orEmpty())
                    ReviewRow("Date", vm.date.toString())
                    if (vm.voucherNo.isNotBlank()) ReviewRow("Voucher", vm.voucherNo)
                    vm.lines.forEach { l ->
                        val lot = lots.firstOrNull { it.id == l.lotId }
                        ReviewRow(lotLabel(lot?.lotNo, lot?.expiryDate), "${fmt(l.sachets(u))} sachets")
                    }
                    ReviewRow("Total", "${fmt(vm.lines.sumOf { it.sachets(u) })} sachets")
                }
            }
        }
    }

    if (camera) {
        CameraCaptureModal(title = "Issue voucher", useFrontCamera = false, onDismiss = { camera = false },
            onPhotoCaptured = { vm.photoPath = it; camera = false })
    }
}
