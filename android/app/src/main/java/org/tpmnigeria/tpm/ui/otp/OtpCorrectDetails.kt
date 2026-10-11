package org.tpmnigeria.tpm.ui.otp

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.data.arr
import org.tpmnigeria.tpm.data.obj
import org.tpmnigeria.tpm.data.objects
import org.tpmnigeria.tpm.data.str
import org.tpmnigeria.tpm.data.strings
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.stock.NumberField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val SOURCES = listOf("caregiver_request", "officer_error", "other")
private fun sourceLabel(s: String) = when (s) { "caregiver_request" -> "Caregiver asked"; "officer_error" -> "Recording error"; else -> "Other" }

/**
 * Correcting a child's or caregiver's details (RUTF DECISIONS R176; DPIA §9, right to
 * rectification). Prefilled from the card; only the fields that change are sent, with who asked
 * and why. Removing the mobile number is how a caregiver stops being phoned. The Child ID never
 * changes. The server keeps a value-free log (which fields, why, who, when) — never the old or
 * new names or numbers — and, as with everything on the card, nothing is stored on the phone.
 */
@Composable
fun CorrectDetailsCard(card: JsonObject, onSaved: () -> Unit, onCancel: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    val id = card.obj("identity")
    val old = remember(card) {
        mapOf(
            "child_name" to id?.str("child_name").orEmpty(), "caregiver_name" to id?.str("caregiver_name").orEmpty(),
            "physical_address" to id?.str("physical_address").orEmpty(), "mobile_number" to id?.str("mobile_number").orEmpty(),
            "sex" to card.str("sex").orEmpty(), "date_of_birth" to card.str("date_of_birth").orEmpty(),
            "age_months_at_registration" to card.str("age_months_at_registration").orEmpty(),
        )
    }
    var childName by remember { mutableStateOf(old.getValue("child_name")) }
    var caregiver by remember { mutableStateOf(old.getValue("caregiver_name")) }
    var address by remember { mutableStateOf(old.getValue("physical_address")) }
    var mobile by remember { mutableStateOf(old.getValue("mobile_number")) }
    var sex by remember { mutableStateOf(old.getValue("sex")) }
    var hasDob by remember { mutableStateOf(old.getValue("date_of_birth").isNotBlank()) }
    var dob by remember { mutableStateOf(old.getValue("date_of_birth").takeIf { it.isNotBlank() }?.let { LocalDate.parse(it) } ?: LocalDate.now().minusYears(2)) }
    var age by remember { mutableStateOf(old.getValue("age_months_at_registration")) }
    var source by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val newDob = if (hasDob) dob.toString() else ""
    val changes = buildJsonObject {
        if (childName.trim() != old["child_name"]) put("child_name", childName.trim())
        if (caregiver.trim() != old["caregiver_name"]) put("caregiver_name", caregiver.trim())
        if (address.trim() != old["physical_address"]) put("physical_address", address.trim())
        if (mobile.trim() != old["mobile_number"]) put("mobile_number", mobile.trim())
        if (sex != old["sex"]) put("sex", sex)
        if (newDob != old["date_of_birth"]) put("date_of_birth", newDob)
        if (!hasDob && age != old["age_months_at_registration"]) age.toIntOrNull()?.let { put("age_months_at_registration", it) }
    }

    TpmCard(blueprint = true) {
        Text("Correct the details", style = MaterialTheme.typography.titleMedium)
        Text("Change only what is wrong. The Child ID stays the same. Only which fields changed, why and by whom is kept — not the old details.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        TpmTextField(label = "Child's name", value = childName, onValueChange = { childName = it })
        ChoiceField("Sex", listOf("F", "M"), sex.takeIf { it.isNotBlank() }, { sex = it }) { if (it == "F") "Girl" else "Boy" }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = hasDob, onCheckedChange = { hasDob = it }); Text("The date of birth is known")
        }
        if (hasDob) DatePickerField(label = "Date of birth", date = dob, onDateChange = { dob = it })
        else NumberField(label = "Age at registration (months)", value = age, onValueChange = { age = it })
        TpmTextField(label = "Caregiver's name", value = caregiver, onValueChange = { caregiver = it })
        TpmTextField(label = "Address / village", value = address, onValueChange = { address = it })
        TpmTextField(label = "Caregiver's mobile number", value = mobile, onValueChange = { mobile = it }, keyboardType = KeyboardType.Phone)
        if (old.getValue("mobile_number").isNotBlank() && mobile.isNotBlank()) {
            TpmButton(text = "Remove the mobile number (caregiver does not want calls)", variant = TpmButtonVariant.Ghost, onClick = { mobile = "" })
        }
        ChoiceField("Who asked for the correction?", SOURCES, source, { source = it }) { sourceLabel(it) }
        TpmTextField(label = "Reason", value = reason, onValueChange = { reason = it }, singleLine = false, minLines = 2,
            placeholder = "e.g. name misspelt at registration; birth certificate seen")
        if (changes.isEmpty()) Text("Nothing changed yet.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
        Row {
            TpmButton(text = "Cancel", variant = TpmButtonVariant.Ghost, onClick = onCancel)
            TpmButton(text = if (busy) "Saving…" else "Save the correction",
                enabled = !busy && changes.isNotEmpty() && source != null && reason.isNotBlank() && childName.isNotBlank(),
                onClick = {
                    busy = true; error = null
                    scope.launch {
                        val body = buildJsonObject {
                            put("child_code", card.str("child_code").orEmpty()); put("reason", reason.trim()); put("source", source!!)
                            changes.forEach { (k, v) -> put(k, v) }
                        }
                        when (val r = repo.correctChild(body)) {
                            is OtpResult.Ok -> {
                                toast.show("Corrected: " + r.data.arr("fields_changed").strings().joinToString())
                                r.data.str("note")?.let { toast.show(it) }
                                onSaved()
                            }
                            is OtpResult.Error -> error = r.message
                        }
                        busy = false
                    }
                })
        }
    }
}

/** The correction history: which fields, why, who asked, by whom, when — no values. */
@Composable
fun CorrectionsHistory(corrections: List<JsonObject>) {
    if (corrections.isEmpty()) return
    val fmt = DateTimeFormatter.ofPattern("d MMM yyyy")
    TpmCard {
        Text("Corrections", style = MaterialTheme.typography.titleMedium)
        corrections.forEach { c ->
            val at = c.str("at")?.take(10)?.let { runCatching { LocalDate.parse(it).format(fmt) }.getOrNull() }.orEmpty()
            Text(c.arr("fields").strings().joinToString().replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodyMedium)
            Text("${sourceLabel(c.str("source").orEmpty())}: ${c.str("reason").orEmpty()} · ${c.str("by").orEmpty()}, $at",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }
    }
}

/** Shown with the card: the history fetched from the server for this child (never stored). */
fun JsonObject.correctionList(): List<JsonObject> = arr("items").objects()
