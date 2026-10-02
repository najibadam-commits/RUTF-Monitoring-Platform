package org.tpmnigeria.tpm.ui.stock

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import org.tpmnigeria.tpm.domain.LedgerSubmissions
import org.tpmnigeria.tpm.domain.StockPosition
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.wizard.common.WizardScaffold
import org.tpmnigeria.tpm.ui.wizard.common.rememberWizardViewModel
import java.time.LocalDate
import java.util.UUID

private val COUNT_STEPS = listOf("Date", "Count by lot", "Compare and submit")

/**
 * Stock Count (brief §8): month-end (or any day) physical count by lot. The expected ledger
 * balance is shown only on the last step, after the count is entered, so it can't anchor the
 * count. Any difference becomes an adjustment pending supervisor confirmation (DECISIONS R7).
 */
class StockCountViewModel(private val stock: StockRepository, val facilityId: String, private val appContext: Context) : ViewModel() {
    private val localId = UUID.randomUUID().toString()
    private var nextKey = 1
    var step by mutableStateOf(1)
        private set
    var date by mutableStateOf(LocalDate.now())
    val lines = mutableStateListOf<LineDraft>()
    private var seeded = false
    var isSubmitting by mutableStateOf(false)
        private set

    /** One line per lot the ledger says is here (any non-zero balance) — counted blind. */
    fun seed(position: StockPosition) {
        if (seeded) return
        seeded = true
        position.lots.filter { it.lotId != null && it.projected != 0 }.forEach { lines += LineDraft(nextKey++, lotId = it.lotId, fixedLot = true) }
        if (lines.isEmpty()) lines += LineDraft(nextKey++)
    }

    fun addLine() { lines += LineDraft(nextKey++) }
    fun update(d: LineDraft) { lines.indexOfFirst { it.key == d.key }.takeIf { it >= 0 }?.let { lines[it] = d } }
    fun remove(d: LineDraft) { lines.removeAll { it.key == d.key } }

    fun isValid(): Boolean = when (step) {
        1 -> !date.isAfter(LocalDate.now())
        2 -> lines.isNotEmpty() && lines.all { it.hasLot && it.quantityEntered } && lines.map { it.lotId ?: it.lotNo.trim().uppercase() }.distinct().size == lines.size
        else -> true
    }

    fun warning(): String = when (step) {
        1 -> "The date can't be in the future."
        2 -> "Enter a count for every lot (0 if none on the shelf), once per lot."
        else -> ""
    }

    fun next() { step = (step + 1).coerceAtMost(COUNT_STEPS.size) }
    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(u: Int): Boolean {
        if (isSubmitting) return false
        isSubmitting = true
        return try {
            val ledgerLines = lines.map { it.toLine(u) }
            stock.submit(
                LedgerSubmissions.stockCount(
                    localId = localId, facilityId = facilityId, date = date.toString(), lines = ledgerLines,
                    deviceId = androidDeviceId(appContext), photos = emptyList(),
                    summary = "Counted ${fmt(ledgerLines.sumOf { it.quantity })} sachets on $date",
                ),
            )
            true
        } finally {
            isSubmitting = false
        }
    }
}

@Composable
fun StockCountScreen(facilityId: String, onDone: () -> Unit, onExit: () -> Unit) {
    val stock = LocalStockRepository.current
    val context = LocalContext.current
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val vm = rememberWizardViewModel { StockCountViewModel(stock, facilityId, context.applicationContext) }
    val u by stock.observeUnitsPerCarton().collectAsState(initial = StockRepository.DEFAULT_UNITS_PER_CARTON)
    val lots by stock.observeLots().collectAsState(initial = emptyList())
    val position by remember(facilityId) { stock.observeStock(facilityId) }.collectAsState(initial = null)
    LaunchedEffect(position) { position?.let(vm::seed) }

    val handleBack = { if (!vm.back()) onExit() }
    BackHandler(onBack = handleBack)
    RegisterHeaderBack(handleBack)

    WizardScaffold(
        stepIndex = vm.step, totalSteps = COUNT_STEPS.size, stepLabel = COUNT_STEPS[vm.step - 1],
        isStepValid = vm.isValid(), warningText = vm.warning(), isSubmitting = vm.isSubmitting,
        continueLabel = if (vm.step == COUNT_STEPS.size) "Submit count" else "Continue",
        onContinue = {
            if (vm.step < COUNT_STEPS.size) vm.next() else scope.launch {
                if (vm.submit(u)) {
                    toast.show("Count saved — it will sync when you're online.")
                    onDone()
                }
            }
        },
    ) {
        when (vm.step) {
            1 -> {
                Text("Count every sachet on the shelf, lot by lot. The month-end count is due by day 5 of the next month.",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                DatePickerField(label = "Count date (the stock position you're counting)", date = vm.date, onDateChange = { vm.date = it })
            }
            2 -> {
                vm.lines.forEach { line ->
                    LotLineEditor(
                        draft = line, onChange = vm::update, lots = lots, unitsPerCarton = u, quantityLabel = "Counted",
                        allowNewLot = true, onRemove = if (!line.fixedLot) ({ vm.remove(line) }) else null,
                    )
                }
                TpmButton(text = "Add a lot found on the shelf", onClick = vm::addLine, variant = TpmButtonVariant.Secondary, fullWidth = true)
            }
            3 -> {
                Text("Your count against the ledger (as far as this phone knows — the server makes the final comparison).",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                vm.lines.forEach { l ->
                    val lot = lots.firstOrNull { it.id == l.lotId }
                    val expected = position?.lots?.firstOrNull { it.lotKey == l.toLine(u).lotKey }?.projected ?: 0
                    val counted = l.sachets(u)
                    TpmCard(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            Text(lotLabel(lot?.lotNo ?: l.lotNo.trim(), lot?.expiryDate ?: l.expiry?.toString()), style = MaterialTheme.typography.titleSmall)
                            ReviewRow("Counted", "${fmt(counted)} sachets")
                            ReviewRow("Ledger", "${fmt(expected)} sachets")
                            if (counted != expected) {
                                val pct = if (expected != 0) " (${"%.1f".format((expected - counted) * 100.0 / expected)}%)" else ""
                                Text("Difference ${"%+,d".format(counted - expected)}$pct — recorded as an adjustment for your supervisor to confirm.",
                                    style = MaterialTheme.typography.bodySmall, color = TpmColors.Accent800)
                            }
                        }
                    }
                }
            }
        }
    }
}
