package org.tpmnigeria.tpm.ui.stock

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.ReferenceRepository
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.data.local.IncomingTransferEntity
import org.tpmnigeria.tpm.domain.LedgerPhoto
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
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

private val RECEIVE_STEPS = listOf("Source", "Lots received", "Waybill photo", "Review")

/**
 * Receive Stock (brief §8): confirm a transfer in transit to this facility — its lots and
 * quantities pre-filled, editable — or record a delivery straight from a supplier. Damaged on
 * arrival is written off on the server. 4 steps; works offline (sync queue).
 */
class ReceiveStockViewModel(
    private val stock: StockRepository,
    val facilityId: String,
    private val appContext: Context,
) : ViewModel() {
    private val localId = UUID.randomUUID().toString()
    private var nextKey = 1

    var step by mutableStateOf(1)
        private set
    /** null = not chosen; "" = supplier delivery; else a transfer id. */
    var source by mutableStateOf<String?>(null)
        private set
    var transfer by mutableStateOf<IncomingTransferEntity?>(null)
        private set
    var date by mutableStateOf(LocalDate.now())
    var documentNo by mutableStateOf("")
    val lines = mutableStateListOf<LineDraft>()
    var photoPath by mutableStateOf<String?>(null)
    var isSubmitting by mutableStateOf(false)
        private set

    suspend fun chooseTransfer(t: IncomingTransferEntity, unitsPerCarton: Int) {
        source = t.id
        transfer = t
        documentNo = t.documentNo.orEmpty()
        lines.clear()
        lines += stock.getTransferLines(t.id).map { LineDraft.prefilled(nextKey++, it.lotId, it.quantity, unitsPerCarton) }
        if (lines.isEmpty()) lines += LineDraft(nextKey++)
    }

    fun chooseSupplier() {
        source = ""
        transfer = null
        lines.clear()
        lines += LineDraft(nextKey++)
    }

    fun addLine() { lines += LineDraft(nextKey++) }
    fun update(d: LineDraft) { lines.indexOfFirst { it.key == d.key }.takeIf { it >= 0 }?.let { lines[it] = d } }
    fun remove(d: LineDraft) { lines.removeAll { it.key == d.key } }

    fun isValid(unitsPerCarton: Int): Boolean = when (step) {
        1 -> source != null && !date.isAfter(LocalDate.now()) &&
            (transfer == null || !date.isBefore(LocalDate.parse(transfer!!.issuedDate))) &&
            (source != "" || documentNo.isNotBlank())
        2 -> lines.isNotEmpty() && lines.all { it.hasLot && it.quantityEntered && it.damagedSachets <= it.sachets(unitsPerCarton) }
        else -> true
    }

    fun warning(): String = when (step) {
        1 -> when {
            source == null -> "Choose the transfer you're receiving, or a supplier delivery."
            date.isAfter(LocalDate.now()) -> "The date can't be in the future."
            transfer != null && date.isBefore(LocalDate.parse(transfer!!.issuedDate)) -> "The date can't be before the transfer was issued (${transfer!!.issuedDate})."
            else -> "Enter the waybill / delivery note number."
        }
        2 -> "Every line needs a lot and a quantity; damaged can't exceed the quantity."
        else -> ""
    }

    fun next() { step = (step + 1).coerceAtMost(RECEIVE_STEPS.size) }
    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(unitsPerCarton: Int, summaryFrom: String): Boolean {
        if (isSubmitting) return false
        isSubmitting = true
        return try {
            val ledgerLines = lines.map { it.toLine(unitsPerCarton) }
            stock.submit(
                LedgerSubmissions.receipt(
                    localId = localId, facilityId = facilityId, date = date.toString(), lines = ledgerLines,
                    transferId = transfer?.id, documentNo = documentNo, deviceId = androidDeviceId(appContext),
                    photos = listOfNotNull(photoPath?.let { LedgerPhoto(it, "waybill") }),
                    summary = "Received ${fmt(ledgerLines.sumOf { it.quantity })} sachets $summaryFrom",
                ),
            )
            true
        } finally {
            isSubmitting = false
        }
    }
}

@Composable
fun ReceiveStockScreen(facilityId: String, onDone: () -> Unit, onExit: () -> Unit) {
    val stock = LocalStockRepository.current
    val references = LocalReferenceRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val vm = rememberWizardViewModel { ReceiveStockViewModel(stock, facilityId, context.applicationContext) }
    val unitsPerCarton by stock.observeUnitsPerCarton().collectAsState(initial = StockRepository.DEFAULT_UNITS_PER_CARTON)
    val lots by stock.observeLots().collectAsState(initial = emptyList())
    val transfers by stock.observeIncomingTransfers(facilityId).collectAsState(initial = emptyList())
    val facility by remember(facilityId) { references.observeFacility(facilityId) }.collectAsState(initial = null)
    val names = rememberFacilityNames(references, transfers.map { it.fromFacilityId })
    var camera by remember { mutableStateOf(false) }

    val handleBack = { if (!vm.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = vm.step,
        totalSteps = RECEIVE_STEPS.size,
        stepLabel = RECEIVE_STEPS[vm.step - 1],
        isStepValid = vm.isValid(unitsPerCarton),
        warningText = vm.warning(),
        isSubmitting = vm.isSubmitting,
        continueLabel = if (vm.step == RECEIVE_STEPS.size) "Record receipt" else "Continue",
        onContinue = {
            if (vm.step < RECEIVE_STEPS.size) vm.next() else scope.launch {
                val from = vm.transfer?.let { "from ${names[it.fromFacilityId] ?: "the supplying store"}" } ?: "from a supplier"
                if (vm.submit(unitsPerCarton, from)) {
                    toast.show("Receipt saved — it will sync when you're online.")
                    onDone()
                }
            }
        },
    ) {
        when (vm.step) {
            1 -> {
                Text("What are you receiving?", style = MaterialTheme.typography.titleMedium)
                if (transfers.isEmpty()) {
                    Text("No transfers are on their way to ${facility?.name ?: "this facility"} (as of the last sync).",
                        style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                }
                transfers.forEach { t ->
                    ChoiceCard(
                        selected = vm.source == t.id,
                        title = "${t.code ?: "Transfer"} · ${fmt(t.sachetsIssued)} sachets",
                        subtitle = "From ${names[t.fromFacilityId] ?: "your supplying store"} · issued ${t.issuedDate}",
                        onClick = { scope.launch { vm.chooseTransfer(t, unitsPerCarton) } },
                    )
                }
                ChoiceCard(
                    selected = vm.source == "",
                    title = "Delivery from a supplier",
                    subtitle = "Not issued through this platform (e.g. a direct UNICEF delivery).",
                    onClick = vm::chooseSupplier,
                )
                DatePickerField(label = "Date received", date = vm.date, onDateChange = { vm.date = it })
                TpmTextField(
                    label = if (vm.source == "") "Waybill / delivery note number" else "Waybill / issue voucher number (optional)",
                    value = vm.documentNo, onValueChange = { vm.documentNo = it },
                )
            }
            2 -> {
                Text(
                    if (vm.transfer != null) "Check each lot against what arrived. Change the quantity if it differs."
                    else "Enter each lot on the delivery, as printed on the carton.",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted,
                )
                vm.lines.forEach { line ->
                    LotLineEditor(
                        draft = line, onChange = vm::update, lots = lots, unitsPerCarton = unitsPerCarton,
                        quantityLabel = "Quantity received", allowNewLot = true, showDamaged = true,
                        onRemove = if (vm.lines.size > 1 && !line.fixedLot) ({ vm.remove(line) }) else null,
                    )
                }
                if (vm.transfer == null) TpmButton(text = "Add another lot", onClick = vm::addLine, variant = TpmButtonVariant.Secondary, fullWidth = true)
            }
            3 -> PhotoCaptureStep(
                label = "Waybill photo",
                hint = "Optional — make sure the header, date, voucher number and signatures are legible.",
                photoPath = vm.photoPath, icon = Icons.Filled.Description, onOpenCamera = { camera = true },
            )
            4 -> {
                val received = vm.lines.sumOf { it.sachets(unitsPerCarton) }
                val damaged = vm.lines.sumOf { it.damagedSachets }
                TpmCard(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        ReviewRow("Source", vm.transfer?.let { "${it.code} from ${names[it.fromFacilityId] ?: "supplying store"}" } ?: "Supplier delivery")
                        ReviewRow("Date", vm.date.toString())
                        if (vm.documentNo.isNotBlank()) ReviewRow("Document", vm.documentNo)
                        vm.lines.forEach { l ->
                            val lot = lots.firstOrNull { it.id == l.lotId }
                            ReviewRow(lotLabel(lot?.lotNo ?: l.lotNo.trim(), lot?.expiryDate ?: l.expiry?.toString()),
                                "${fmt(l.sachets(unitsPerCarton))} sachets" + if (l.damagedSachets > 0) " (${fmt(l.damagedSachets)} damaged)" else "")
                        }
                        ReviewRow("Total received", "${fmt(received)} sachets" + if (damaged > 0) ", ${fmt(damaged)} damaged — written off" else "")
                        ReviewRow("Waybill photo", if (vm.photoPath != null) "Captured" else "None")
                    }
                }
                vm.transfer?.let { t ->
                    if (received != t.sachetsIssued) {
                        Text("${fmt(t.sachetsIssued)} sachets were issued — this receipt is ${fmt(received - t.sachetsIssued)} different. It will be recorded as a discrepancy for review.",
                            style = MaterialTheme.typography.bodySmall, color = TpmColors.Warning)
                    }
                }
            }
        }
    }

    if (camera) {
        CameraCaptureModal(title = "Waybill", useFrontCamera = false, onDismiss = { camera = false },
            onPhotoCaptured = { vm.photoPath = it; camera = false })
    }
}

@Composable
fun ChoiceCard(selected: Boolean, title: String, subtitle: String, onClick: () -> Unit) {
    TpmCard(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick), blueprint = selected) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = onClick)
            Column {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
        }
    }
}

/** id -> facility name from the offline cache, for the ids a screen mentions. */
@Composable
fun rememberFacilityNames(references: ReferenceRepository, ids: List<String>): Map<String, String> {
    val names = remember { mutableStateMapOf<String, String>() }
    LaunchedEffect(ids) {
        for (id in ids.distinct()) if (id !in names) references.getFacility(id)?.let { names[id] = it.name }
    }
    return names
}
