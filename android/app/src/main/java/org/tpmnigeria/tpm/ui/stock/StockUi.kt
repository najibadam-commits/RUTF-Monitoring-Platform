package org.tpmnigeria.tpm.ui.stock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import org.tpmnigeria.tpm.data.local.LotRefEntity
import org.tpmnigeria.tpm.domain.LedgerLine
import org.tpmnigeria.tpm.domain.toSachets
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.time.LocalDate

// Shared pieces for the facility stock screens (brief §8). Quantities are entered as cartons +
// loose sachets the way they sit on the shelf; the app always records sachets.

/** One lot line being edited. [lotId] null = a lot not yet in the list, typed off the carton. */
data class LineDraft(
    val key: Int,
    val lotId: String? = null,
    val lotNo: String = "",
    val expiry: LocalDate? = null,
    val cartons: String = "",
    val loose: String = "",
    val damaged: String = "",
    /** Lot comes from the transfer / an existing balance and can't be changed here. */
    val fixedLot: Boolean = false,
    /** What the document says should be here (transfer quantity, available balance). */
    val reference: Int? = null,
) {
    fun sachets(unitsPerCarton: Int) = toSachets(cartons.toIntOrNull() ?: 0, loose.toIntOrNull() ?: 0, unitsPerCarton)
    val damagedSachets: Int get() = damaged.toIntOrNull() ?: 0
    val hasLot: Boolean get() = lotId != null || (lotNo.isNotBlank() && expiry != null)
    val quantityEntered: Boolean get() = cartons.isNotBlank() || loose.isNotBlank()

    fun toLine(unitsPerCarton: Int) = LedgerLine(
        lotId = lotId,
        lotNo = if (lotId == null) lotNo.trim() else null,
        expiryDate = if (lotId == null) expiry?.toString() else null,
        quantity = sachets(unitsPerCarton),
        damaged = damagedSachets,
    )

    companion object {
        /** Splits a sachet count back into cartons + loose for pre-filling. */
        fun prefilled(key: Int, lotId: String?, sachets: Int, unitsPerCarton: Int, reference: Int? = sachets) = LineDraft(
            key = key, lotId = lotId, fixedLot = lotId != null,
            cartons = (sachets / unitsPerCarton).toString(), loose = (sachets % unitsPerCarton).toString(), reference = reference,
        )
    }
}

fun lotLabel(lotNo: String?, expiry: String?): String = buildString {
    append(lotNo?.let { "Lot $it" } ?: "No lot recorded")
    expiry?.let { append(" · exp. $it") }
}

private val digitsOnly = Regex("\\d{0,7}")

@Composable
fun QuantityInput(
    label: String,
    cartons: String,
    loose: String,
    onCartons: (String) -> Unit,
    onLoose: (String) -> Unit,
    unitsPerCarton: Int,
) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2), verticalAlignment = Alignment.Bottom) {
            TpmTextField(
                label = "Cartons ($unitsPerCarton each)", value = cartons, keyboardType = KeyboardType.Number,
                onValueChange = { if (it.matches(digitsOnly)) onCartons(it) }, modifier = Modifier.weight(1f),
            )
            TpmTextField(
                label = "Loose sachets", value = loose, keyboardType = KeyboardType.Number,
                onValueChange = { if (it.matches(digitsOnly)) onLoose(it) }, modifier = Modifier.weight(1f),
            )
        }
        Text(
            "= ${"%,d".format(toSachets(cartons.toIntOrNull() ?: 0, loose.toIntOrNull() ?: 0, unitsPerCarton))} sachets",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted,
        )
    }
}

@Composable
fun NumberField(label: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier) {
    TpmTextField(label = label, value = value, keyboardType = KeyboardType.Number, modifier = modifier,
        onValueChange = { if (it.matches(digitsOnly)) onValueChange(it) })
}

private sealed interface LotChoice {
    data class Existing(val lot: LotRefEntity) : LotChoice
    data object New : LotChoice
}

/** A lot line: pick a listed lot (or type a new one off the carton), then the quantity. */
@Composable
fun LotLineEditor(
    draft: LineDraft,
    onChange: (LineDraft) -> Unit,
    lots: List<LotRefEntity>,
    unitsPerCarton: Int,
    quantityLabel: String,
    allowNewLot: Boolean,
    showDamaged: Boolean = false,
    onRemove: (() -> Unit)? = null,
) {
    TpmCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
            if (draft.fixedLot) {
                val lot = lots.firstOrNull { it.id == draft.lotId }
                Text(lotLabel(lot?.lotNo, lot?.expiryDate), style = MaterialTheme.typography.titleSmall)
            } else {
                val options: List<LotChoice> = lots.map { LotChoice.Existing(it) } + if (allowNewLot) listOf(LotChoice.New) else emptyList()
                val selected: LotChoice? = when {
                    draft.lotId != null -> lots.firstOrNull { it.id == draft.lotId }?.let { LotChoice.Existing(it) }
                    draft.lotNo.isNotEmpty() || draft.expiry != null -> LotChoice.New
                    else -> null
                }
                TpmDropdown(
                    label = "Lot", selected = selected, options = options,
                    labelFor = { if (it is LotChoice.Existing) lotLabel(it.lot.lotNo, it.lot.expiryDate) else "A lot not in the list…" },
                    onSelect = { choice ->
                        onChange(
                            when (choice) {
                                is LotChoice.Existing -> draft.copy(lotId = choice.lot.id, lotNo = "", expiry = null)
                                LotChoice.New -> draft.copy(lotId = null, lotNo = " ", expiry = LocalDate.now().plusYears(1))
                            },
                        )
                    },
                    emptyLabel = "No lots available",
                )
                if (draft.lotId == null && (draft.lotNo.isNotEmpty() || draft.expiry != null)) {
                    TpmTextField(label = "Lot number (as printed on the carton)", value = draft.lotNo.trimStart(), onValueChange = { onChange(draft.copy(lotNo = it)) })
                    DatePickerField(label = "Expiry date", date = draft.expiry ?: LocalDate.now().plusYears(1), onDateChange = { onChange(draft.copy(expiry = it)) })
                }
            }
            QuantityInput(
                label = quantityLabel, cartons = draft.cartons, loose = draft.loose,
                onCartons = { onChange(draft.copy(cartons = it)) }, onLoose = { onChange(draft.copy(loose = it)) },
                unitsPerCarton = unitsPerCarton,
            )
            draft.reference?.let { ref ->
                val entered = draft.sachets(unitsPerCarton)
                if (draft.quantityEntered && entered != ref) {
                    Text("Document says ${"%,d".format(ref)} sachets — difference ${"%+,d".format(entered - ref)}.",
                        style = MaterialTheme.typography.bodySmall, color = TpmColors.Accent800)
                }
            }
            if (showDamaged) {
                NumberField(label = "Of which damaged (sachets)", value = draft.damaged, onValueChange = { onChange(draft.copy(damaged = it)) })
            }
            onRemove?.let { TpmButton(text = "Remove this lot", onClick = it, variant = TpmButtonVariant.Ghost) }
        }
    }
}

@Composable
fun ReviewRow(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

fun fmt(n: Int): String = "%,d".format(n)
