package org.tpmnigeria.tpm.ui.stock

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.data.local.FacilityRefEntity
import org.tpmnigeria.tpm.domain.LedgerKind
import org.tpmnigeria.tpm.domain.LedgerPhoto
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.domain.OtpRecount
import org.tpmnigeria.tpm.domain.StoreChecklist
import org.tpmnigeria.tpm.domain.VisitCount
import org.tpmnigeria.tpm.domain.VisitCountLine
import org.tpmnigeria.tpm.domain.VisitThresholds
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.domain.distanceMeters
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.previewVisitFindings
import org.tpmnigeria.tpm.domain.verificationFactor
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmSegmentedControl
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.components.modal.GpsCaptureModal
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.wizard.common.GpsCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel
import java.time.LocalDate
import java.util.UUID

private val STORE_STEPS = listOf("Store", "GPS", "Stock card", "Count by lot", "Storage", "Evidence", "Review")
private val OTP_STEPS = listOf("OTP and period", "GPS", "Register", "Recount", "Count by lot", "Evidence", "Review")

/** One counted lot: quantity on the shelf (cartons + loose), plus expired and the stock-card figure. */
data class VisitLineDraft(val line: LineDraft, val expired: String = "", val stockCard: String = "")

/**
 * Supervision visit (brief §8): A. Store Check at an LGA / State store, B. OTP Verification at an
 * OTP site — 7 steps each, offline through the sync queue, recorded with record_visit (web
 * migration 0103), which raises the visit's Findings into review. The count is blind: the ledger
 * balance appears only on the review step, next to the Findings this visit will raise.
 */
class SupervisionVisitViewModel(
    private val stock: StockRepository,
    val kind: LedgerKind,
    private val appContext: Context,
) : ViewModel() {
    private val localId = UUID.randomUUID().toString()
    private var nextKey = 1
    val steps = if (kind == LedgerKind.StoreCheck) STORE_STEPS else OTP_STEPS
    val isStore = kind == LedgerKind.StoreCheck

    var step by mutableStateOf(1)
        private set
    var facility by mutableStateOf<FacilityRefEntity?>(null)
        private set
    var visitDate by mutableStateOf(LocalDate.now())
    // OTP: by default the previous calendar month.
    var periodStart by mutableStateOf(LocalDate.now().withDayOfMonth(1).minusMonths(1))
    var periodEnd by mutableStateOf(LocalDate.now().withDayOfMonth(1).minusDays(1))
    var gps by mutableStateOf<GpsCapture?>(null)

    // Store checklist (nullable = not answered yet).
    var stockCardPresent by mutableStateOf<Boolean?>(null)
    var stockCardUpToDate by mutableStateOf<Boolean?>(null)
    var storageDry by mutableStateOf<Boolean?>(null)
    var storageOffFloor by mutableStateOf<Boolean?>(null)
    var storageVentilated by mutableStateOf<Boolean?>(null)
    var pestsSeen by mutableStateOf<Boolean?>(null)
    var fefoFollowed by mutableStateOf<Boolean?>(null)

    // OTP register recount.
    var registerPresent by mutableStateOf<Boolean?>(null)
    var admissionsCounted by mutableStateOf("")
    var dispensedCounted by mutableStateOf("")
    var recorded by mutableStateOf<Pair<Int, Int>?>(null) // admissions, dispensed in the app for the period
        private set

    val lines = mutableStateListOf<VisitLineDraft>()
    val ledgerByLot = mutableStateMapOf<String, Int>()
    var notes by mutableStateOf("")
    val photos = mutableStateMapOf<String, String>() // kind -> local path
    var namesCovered by mutableStateOf(false)
    var isSubmitting by mutableStateOf(false)
        private set

    suspend fun chooseFacility(f: FacilityRefEntity) {
        facility = f
        val balances = stock.getBalances(f.id)
        ledgerByLot.clear()
        balances.forEach { ledgerByLot[it.lotKey] = it.balance }
        lines.clear()
        balances.filter { it.lotId != null && it.balance != 0 }.forEach {
            lines += VisitLineDraft(LineDraft(nextKey++, lotId = it.lotId, fixedLot = true))
        }
        if (lines.isEmpty()) lines += VisitLineDraft(LineDraft(nextKey++))
        refreshRecorded()
    }

    suspend fun refreshRecorded() {
        val f = facility ?: return
        if (!isStore) recorded = stock.getRecordedDispensing(f.id, periodStart, periodEnd)
    }

    fun addLine() { lines += VisitLineDraft(LineDraft(nextKey++)) }
    fun update(d: VisitLineDraft) { lines.indexOfFirst { it.line.key == d.line.key }.takeIf { it >= 0 }?.let { lines[it] = d } }
    fun remove(d: VisitLineDraft) { lines.removeAll { it.line.key == d.line.key } }

    val distanceM: Int?
        get() {
            val f = facility ?: return null
            val g = gps ?: return null
            return if (f.lat != null && f.lng != null) distanceMeters(g.lat, g.lng, f.lat, f.lng) else null
        }

    private val stepName get() = steps[step - 1]

    fun isValid(u: Int): Boolean = when (stepName) {
        "Store", "OTP and period" -> facility != null && !visitDate.isAfter(LocalDate.now()) &&
            (isStore || (!periodStart.isAfter(periodEnd) && !periodEnd.isAfter(visitDate)))
        "GPS" -> gps != null
        "Stock card" -> stockCardPresent != null && (stockCardPresent == false || stockCardUpToDate != null)
        "Storage" -> listOf(storageDry, storageOffFloor, storageVentilated, pestsSeen, fefoFollowed).all { it != null }
        "Register" -> registerPresent != null
        "Recount" -> registerPresent == false || (admissionsCounted.isNotBlank() && dispensedCounted.isNotBlank())
        "Count by lot" -> lines.isNotEmpty() && lines.all { it.line.hasLot && it.line.quantityEntered && (it.expired.toIntOrNull() ?: 0) <= it.line.sachets(u) } &&
            lines.map { it.line.lotId ?: it.line.lotNo.trim().uppercase() }.distinct().size == lines.size
        "Evidence" -> photos.containsKey("selfie") && (!photos.containsKey("register_page") || namesCovered)
        else -> true
    }

    fun warning(): String = when (stepName) {
        "Store", "OTP and period" -> when {
            facility == null -> "Choose the facility you are visiting."
            visitDate.isAfter(LocalDate.now()) -> "The visit date can't be in the future."
            else -> "The period must end on or before the visit date."
        }
        "GPS" -> "Capture your GPS location at the facility."
        "Stock card", "Storage", "Register" -> "Answer every question."
        "Recount" -> "Enter the admissions and sachets dispensed from the register for the period."
        "Count by lot" -> "Count every lot (0 if none), once per lot; expired can't exceed the count."
        "Evidence" -> if (!photos.containsKey("selfie")) "A selfie at the facility is required." else "Confirm that names are covered in the register photo."
        else -> ""
    }

    fun next() { step = (step + 1).coerceAtMost(steps.size) }
    fun back(): Boolean = if (step > 1) { step--; true } else false

    fun counts(u: Int) = lines.map { VisitCount(ledgerByLot[it.line.toLine(u).lotKey], it.line.sachets(u), it.expired.toIntOrNull() ?: 0) }

    fun preview(u: Int) = previewVisitFindings(
        // Hard-to-reach isn't in the phone's facility cache: the preview uses the standard 5 %
        // limit, and the server applies the 10 % limit where it's due.
        counts(u), hardToReach = false,
        store = if (isStore) StoreChecklist(stockCardPresent ?: false, stockCardUpToDate, storageDry, storageOffFloor, pestsSeen) else null,
        otp = if (!isStore) OtpRecount(registerPresent ?: false, dispensedCounted.toIntOrNull(), recorded?.second ?: 0) else null,
    )

    suspend fun submit(u: Int): Boolean {
        val f = facility ?: return false
        val g = gps ?: return false
        if (isSubmitting) return false
        isSubmitting = true
        return try {
            val checklist = buildJsonObject {
                if (isStore) {
                    put("stock_card_present", stockCardPresent); put("stock_card_up_to_date", stockCardUpToDate)
                    put("storage_dry", storageDry); put("storage_off_floor", storageOffFloor); put("storage_ventilated", storageVentilated)
                    put("pests_seen", pestsSeen); put("fefo_followed", fefoFollowed)
                } else {
                    put("register_present", registerPresent)
                    if (registerPresent == true) {
                        put("admissions_counted", admissionsCounted.toIntOrNull()); put("sachets_dispensed_counted", dispensedCounted.toIntOrNull())
                    }
                }
                put("notes", notes.takeIf { it.isNotBlank() })
            }
            stock.submit(
                LedgerSubmissions.visit(
                    kind = kind, localId = localId, facilityId = f.id, date = visitDate.toString(), lat = g.lat, lng = g.lng,
                    accuracyM = g.accuracyMeters,
                    lines = lines.map {
                        val l = it.line.toLine(u)
                        VisitCountLine(l.lotId, l.lotNo, l.expiryDate, it.stockCard.toIntOrNull(), l.quantity, 0, it.expired.toIntOrNull() ?: 0)
                    },
                    checklist = checklist, periodStart = if (isStore) null else periodStart.toString(),
                    periodEnd = if (isStore) null else periodEnd.toString(), deviceId = androidDeviceId(appContext),
                    photos = photos.map { (k, path) -> LedgerPhoto(path, k) },
                    summary = "${if (isStore) "Store check" else "OTP verification"} at ${f.name}",
                ),
            )
            true
        } finally {
            isSubmitting = false
        }
    }
}

@Composable
fun SupervisionVisitScreen(kind: LedgerKind, supervisionLevel: String, onDone: () -> Unit, onExit: () -> Unit) {
    val stock = LocalStockRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val vm = rememberWizardViewModel { SupervisionVisitViewModel(stock, kind, context.applicationContext) }
    val u by stock.observeUnitsPerCarton().collectAsState(initial = StockRepository.DEFAULT_UNITS_PER_CARTON)
    val lots by stock.observeLots().collectAsState(initial = emptyList())
    val supervised by remember(supervisionLevel) { stock.observeSupervisedFacilities(supervisionLevel) }.collectAsState(initial = emptyList())
    val options = supervised.filter { if (vm.isStore) it.facilityType != "health_facility" else it.isOtpSite }
    var modal by remember { mutableStateOf<String?>(null) } // "gps" or a photo kind
    LaunchedEffect(vm.periodStart, vm.periodEnd) { vm.refreshRecorded() }

    val handleBack = { if (!vm.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = vm.step, totalSteps = vm.steps.size, stepLabel = vm.steps[vm.step - 1],
        isStepValid = vm.isValid(u), warningText = vm.warning(), isSubmitting = vm.isSubmitting,
        continueLabel = if (vm.step == vm.steps.size) "Submit visit" else "Continue",
        onContinue = {
            if (vm.step < vm.steps.size) vm.next() else scope.launch {
                if (vm.submit(u)) {
                    toast.show("Visit saved — it will sync when you're online.")
                    onDone()
                }
            }
        },
    ) {
        when (vm.steps[vm.step - 1]) {
            "Store", "OTP and period" -> {
                TpmDropdown(
                    label = if (vm.isStore) "Store" else "OTP site", selected = vm.facility, options = options,
                    labelFor = { it.name }, onSelect = { f -> scope.launch { vm.chooseFacility(f) } },
                    emptyLabel = "No facilities assigned to you (as of the last sync)",
                )
                DatePickerField(label = "Visit date", date = vm.visitDate, onDateChange = { vm.visitDate = it })
                if (!vm.isStore) {
                    Text("Period to recount from the register", style = MaterialTheme.typography.titleSmall)
                    DatePickerField(label = "From", date = vm.periodStart, onDateChange = { vm.periodStart = it })
                    DatePickerField(label = "To", date = vm.periodEnd, onDateChange = { vm.periodEnd = it })
                }
            }
            "GPS" -> {
                GpsCaptureStep(vm.gps, onOpenGpsModal = { modal = "gps" })
                vm.distanceM?.let { d ->
                    Text(
                        if (d > VisitThresholds.GEOFENCE_M) "You are about ${fmt(d)} m from the facility's recorded location — more than ${VisitThresholds.GEOFENCE_M} m. The visit will be flagged; recapture at the facility if you can."
                        else "About ${fmt(d)} m from the facility's recorded location.",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (d > VisitThresholds.GEOFENCE_M) TpmColors.Warning else TpmColors.TextMuted,
                    )
                }
            }
            "Stock card" -> {
                YesNo("Is there a stock card for RUTF?", vm.stockCardPresent) { vm.stockCardPresent = it; if (!it) vm.stockCardUpToDate = null }
                if (vm.stockCardPresent == true) YesNo("Is it up to date (every receipt and issue entered)?", vm.stockCardUpToDate) { vm.stockCardUpToDate = it }
            }
            "Storage" -> {
                YesNo("Is the store dry?", vm.storageDry) { vm.storageDry = it }
                YesNo("Is stock off the floor (on pallets or shelves)?", vm.storageOffFloor) { vm.storageOffFloor = it }
                YesNo("Is the store ventilated?", vm.storageVentilated) { vm.storageVentilated = it }
                YesNo("Any signs of pests?", vm.pestsSeen) { vm.pestsSeen = it }
                YesNo("Is first-expiry-first-out followed?", vm.fefoFollowed) { vm.fefoFollowed = it }
                TpmTextField(label = "Notes (optional)", value = vm.notes, onValueChange = { vm.notes = it }, singleLine = false, minLines = 2)
            }
            "Register" -> {
                YesNo("Is the OTP register available?", vm.registerPresent) { vm.registerPresent = it }
                if (vm.registerPresent == false) Text("A missing register is recorded as a Finding for review.", style = MaterialTheme.typography.bodySmall, color = TpmColors.Warning)
            }
            "Recount" -> {
                if (vm.registerPresent == false) {
                    Text("No register — nothing to recount. Continue to the stock count.", style = MaterialTheme.typography.bodyMedium)
                } else {
                    Text("Count from the register for ${vm.periodStart} to ${vm.periodEnd}. Totals only — no names.",
                        style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                    NumberField(label = "New admissions in the period", value = vm.admissionsCounted, onValueChange = { vm.admissionsCounted = it })
                    NumberField(label = "Sachets dispensed in the period", value = vm.dispensedCounted, onValueChange = { vm.dispensedCounted = it })
                    TpmTextField(label = "Notes (optional)", value = vm.notes, onValueChange = { vm.notes = it }, singleLine = false, minLines = 2)
                }
            }
            "Count by lot" -> {
                Text("Count what is physically on the shelf, lot by lot.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                vm.lines.forEach { v ->
                    LotLineEditor(
                        draft = v.line, onChange = { vm.update(v.copy(line = it)) }, lots = lots, unitsPerCarton = u,
                        quantityLabel = "Counted on the shelf", allowNewLot = true,
                        onRemove = if (!v.line.fixedLot) ({ vm.remove(v) }) else null,
                    )
                    Row {
                        NumberField(label = "Of which expired", value = v.expired, onValueChange = { vm.update(v.copy(expired = it)) }, modifier = Modifier.weight(1f))
                        if (vm.isStore) NumberField(label = "Stock card balance", value = v.stockCard, onValueChange = { vm.update(v.copy(stockCard = it)) }, modifier = Modifier.weight(1f))
                    }
                }
                TpmButton(text = "Add a lot found on the shelf", onClick = vm::addLine, variant = TpmButtonVariant.Secondary, fullWidth = true)
            }
            "Evidence" -> {
                if (vm.isStore) {
                    PhotoCaptureStep("Stock card", "Optional — headers, dates and signatures legible.", vm.photos["stock_card"], Icons.Filled.Description) { modal = "stock_card" }
                } else {
                    PhotoCaptureStep("Register page", "Optional — cover every child and caregiver name first.", vm.photos["register_page"], Icons.Filled.MenuBook) { modal = "register_page" }
                    if (vm.photos.containsKey("register_page")) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = vm.namesCovered, onCheckedChange = { vm.namesCovered = it })
                            Text("Child and caregiver names are covered in this photo", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                PhotoCaptureStep("Stock", "Optional — the stack of RUTF cartons.", vm.photos["stock"], Icons.Filled.Inventory) { modal = "stock" }
                PhotoCaptureStep("Selfie at the facility", "Required.", vm.photos["selfie"], Icons.Filled.Person) { modal = "selfie" }
            }
            else -> VisitReview(vm, u, lots)
        }
    }

    when (val m = modal) {
        null -> {}
        "gps" -> GpsCaptureModal(onDismiss = { modal = null }, onUseLocation = { vm.gps = it; modal = null })
        else -> CameraCaptureModal(
            title = m.replace('_', ' ').replaceFirstChar { it.uppercase() }, useFrontCamera = m == "selfie",
            onDismiss = { modal = null },
            onPhotoCaptured = { path -> vm.photos[m] = path; if (m == "register_page") vm.namesCovered = false; modal = null },
        )
    }
}

@Composable
private fun YesNo(question: String, value: Boolean?, onChange: (Boolean) -> Unit) {
    Column {
        Text(question, style = MaterialTheme.typography.bodyMedium)
        TpmSegmentedControl(options = listOf(true, false), selected = value, onSelect = onChange, labelFor = { if (it) "Yes" else "No" })
    }
}

@Composable
private fun VisitReview(vm: SupervisionVisitViewModel, u: Int, lots: List<org.tpmnigeria.tpm.data.local.LotRefEntity>) {
    TpmCard(modifier = Modifier.fillMaxWidth()) {
        Column {
            ReviewRow(if (vm.isStore) "Store" else "OTP site", vm.facility?.name.orEmpty())
            ReviewRow("Visit date", vm.visitDate.toString())
            if (!vm.isStore) ReviewRow("Period", "${vm.periodStart} to ${vm.periodEnd}")
            ReviewRow("Distance from the facility point", vm.distanceM?.let { "${fmt(it)} m" + if (it > VisitThresholds.GEOFENCE_M) " — outside the geofence" else "" } ?: "Facility has no recorded location")
        }
    }
    Text("Your count against the ledger (as of the last sync)", style = MaterialTheme.typography.titleSmall)
    vm.lines.forEach { v ->
        val lot = lots.firstOrNull { it.id == v.line.lotId }
        val ledger = vm.ledgerByLot[v.line.toLine(u).lotKey]
        TpmCard(modifier = Modifier.fillMaxWidth()) {
            Text(lotLabel(lot?.lotNo ?: v.line.lotNo.trim(), lot?.expiryDate ?: v.line.expiry?.toString()), style = MaterialTheme.typography.titleSmall)
            ReviewRow("Counted", "${fmt(v.line.sachets(u))} sachets" + ((v.expired.toIntOrNull() ?: 0).takeIf { it > 0 }?.let { " (${fmt(it)} expired)" } ?: ""))
            ReviewRow("Ledger", ledger?.let { "${fmt(it)} sachets" } ?: "Not in the ledger")
        }
    }
    if (!vm.isStore && vm.registerPresent == true) {
        val rec = vm.recorded?.second ?: 0
        val counted = vm.dispensedCounted.toIntOrNull()
        ReviewRow("Sachets dispensed — register / app", "${counted?.let(::fmt) ?: "—"} / ${fmt(rec)}" +
            if (counted != null && rec > 0) " · VF ${"%.2f".format(verificationFactor(counted, rec))}" else "")
    }
    val findings = vm.preview(u)
    Text("Findings this visit will raise", style = MaterialTheme.typography.titleSmall)
    if (findings.isEmpty()) {
        Text("None — everything is within the limits.", style = MaterialTheme.typography.bodyMedium)
    } else {
        findings.forEach { f ->
            TpmCard(modifier = Modifier.fillMaxWidth()) {
                Text(f.label, style = MaterialTheme.typography.titleSmall)
                Text(f.detail, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
        }
        Text("Findings go to the State reviewer before anyone else sees them — they are for review, not accusation.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
    }
}
