package org.tpmnigeria.tpm.ui.otp

import android.app.Activity
import android.view.WindowManager
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import org.tpmnigeria.tpm.data.arr
import org.tpmnigeria.tpm.data.str
import org.tpmnigeria.tpm.data.strings
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmSegmentedControl
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.theme.TpmColors

/** Colours for the pathway result: green go, red refer, amber wait — the design system's semantic
 *  colours (R164), always next to words, never alone. */
internal val OtpGreen = TpmColors.Success
internal val OtpRed = TpmColors.Error
internal val OtpAmber = TpmColors.Warning

/** Blocks screenshots and screen recording while a child's details are on screen (privacy rule). */
@Composable
fun SecureScreen() {
    val activity = LocalContext.current as? Activity
    DisposableEffect(activity) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

private val decimal = Regex("""^\d{0,3}(\.\d?)?$""")
private val signedDecimal = Regex("""^-?\d{0,2}(\.\d{0,2})?$""")

/** A measurement to one decimal place (weight, MUAC, height, temperature). */
@Composable
fun DecimalField(label: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier, signed: Boolean = false) {
    TpmTextField(label = label, value = value, keyboardType = KeyboardType.Decimal, modifier = modifier,
        onValueChange = { if (it.matches(if (signed) signedDecimal else decimal)) onValueChange(it) })
}

/** A labelled one-of choice (sex, oedema grade, yes / no). */
@Composable
fun <T> ChoiceField(label: String, options: List<T>, selected: T?, onSelect: (T) -> Unit, labelFor: (T) -> String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Spacer(Modifier.height(5.dp))
        TpmSegmentedControl(options = options, selected = selected, onSelect = onSelect, labelFor = labelFor)
    }
}

val OEDEMA = listOf("absent", "+", "++", "+++")
fun oedemaLabel(o: String) = when (o) { "absent" -> "None"; "+" -> "+ feet"; "++" -> "++ legs"; else -> "+++ all" }

val PATHWAY_LABEL = mapOf(
    "otp" to "Admit to the Outpatient Therapeutic Programme",
    "stabilisation" to "Refer to stabilisation care",
    "inpatient_paediatric" to "Refer to inpatient paediatric care",
    "nutrition_advice" to "Moderate: MNP (if MUAC yellow) and nutrition advice",
    "praise_advice" to "Normal: praise and advise",
    "clinical_review" to "Refer for clinical review",
    "incomplete" to "More information needed",
    "correct_inputs" to "Correct the measurements",
)

val ADMISSION_TYPE_LABEL = mapOf(
    "new_case" to "New case",
    "from_stabilisation" to "From stabilisation care",
    "transfer_from_otp" to "Transfer from another OTP site",
    "returned_defaulter" to "Returned defaulter",
)

val OUTCOME_LABEL = mapOf(
    "cured" to "Discharged cured",
    "defaulted" to "Defaulted",
    "died" to "Died",
    "non_recovered" to "Non-recovered",
    "transferred_inpatient" to "Transferred to inpatient care",
    "refused_inpatient" to "Refused inpatient care",
    "transferred_otp" to "Transferred to another OTP site",
)

/** The engine's answer: the pathway, the next action, and why, with what's missing or needs review. */
@Composable
fun PathwayResultCard(result: JsonObject) {
    val pathway = result.str("pathway").orEmpty()
    val colour = when (pathway) {
        "otp" -> OtpGreen
        "stabilisation", "inpatient_paediatric", "clinical_review" -> OtpRed
        else -> OtpAmber
    }
    TpmCard(blueprint = true) {
        result.str("classification")?.let {
            Text("Classification: $it", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }
        Text(PATHWAY_LABEL[pathway] ?: pathway, style = MaterialTheme.typography.titleMedium, color = colour, fontWeight = FontWeight.SemiBold)
        result.str("next_action")?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        BulletList("Because", result.arr("reasons").strings())
        BulletList("Still needed", result.arr("missing").strings(), OtpAmber)
        BulletList("Check these values", result.arr("errors").strings(), OtpRed)
        BulletList("Needs clinical review", result.arr("review").strings(), OtpRed)
        RuleStatus(result)
    }
}

@Composable
fun BulletList(title: String, items: List<String>, colour: Color = TpmColors.Text) {
    if (items.isEmpty()) return
    Text(title, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
    items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, color = colour) }
}

/** Every result states its rule set; a draft one is flagged as awaiting the clinical authority. */
@Composable
fun RuleStatus(result: JsonObject) {
    val set = result.str("rule_set") ?: return
    val draft = result.str("rule_status") != "approved"
    Text(
        if (draft) "Rules $set: draft, awaiting clinical sign-off" else "Rules $set: approved",
        style = MaterialTheme.typography.bodySmall, color = if (draft) OtpAmber else TpmColors.TextMuted,
    )
}
