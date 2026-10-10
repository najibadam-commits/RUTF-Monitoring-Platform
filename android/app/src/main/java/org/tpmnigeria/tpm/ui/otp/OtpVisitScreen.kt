package org.tpmnigeria.tpm.ui.otp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.data.arr
import org.tpmnigeria.tpm.data.bool
import org.tpmnigeria.tpm.data.str
import org.tpmnigeria.tpm.data.strings
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.NumberField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.util.UUID

/**
 * A follow-up visit (card C2). The ration is read from the 92 g table at this visit's weight
 * (RULEBOOK §6) and shown as the weight is typed; the database applies it, the card's alerts
 * (weight below admission weight, no change by the 4th visit, severe oedema, poor appetite,
 * consecutive absences) and the dispensing check (a different quantity needs a reason).
 */
@Composable
fun OtpVisitScreen(childCode: String, onDone: () -> Unit, onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)
    SecureScreen()

    var attended by remember { mutableStateOf(true) }
    var weight by remember { mutableStateOf("") }
    var height by remember { mutableStateOf("") }
    var muac by remember { mutableStateOf("") }
    var oedema by remember { mutableStateOf<String?>("absent") }
    var wfh by remember { mutableStateOf("") }
    var appetite by remember { mutableStateOf<String?>(null) }
    var diarrhoea by remember { mutableStateOf("") }
    var vomiting by remember { mutableStateOf("") }
    var fever by remember { mutableStateOf("") }
    var cough by remember { mutableStateOf("") }
    var temperature by remember { mutableStateOf("") }
    var respiratory by remember { mutableStateOf("") }
    var dehydrated by remember { mutableStateOf<Boolean?>(null) }
    var pallor by remember { mutableStateOf<Boolean?>(null) }
    var infection by remember { mutableStateOf<Boolean?>(null) }
    var actionDetails by remember { mutableStateOf("") }
    var dispensed by remember { mutableStateOf("") }
    var dispenseNote by remember { mutableStateOf("") }
    var initials by remember { mutableStateOf("") }
    var ration by remember { mutableStateOf<JsonObject?>(null) }
    var saved by remember { mutableStateOf<JsonObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val clientId = remember { UUID.randomUUID().toString() }

    // The ration for the typed weight, from the table (after a short pause in typing).
    LaunchedEffect(weight) {
        ration = null
        val w = weight.toDoubleOrNull() ?: return@LaunchedEffect
        delay(500)
        ration = (repo.ration(w) as? OtpResult.Ok)?.data
        val perWeek = ration?.takeIf { it.bool("ok") }?.str("packets_per_week")
        if (perWeek != null && dispensed.isBlank()) dispensed = perWeek
    }

    val yesNo = listOf(false, true)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
    ) {
        Text("Visit · $childCode", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        val done = saved
        if (done != null) {
            TpmCard(blueprint = true) {
                Text("Visit ${done.str("visit_number")} recorded", style = MaterialTheme.typography.titleMedium, color = OtpGreen)
                BulletList("Alerts", done.arr("alerts").strings(), OtpAmber)
            }
            TpmButton(text = "Back to the card", onClick = onDone, fullWidth = true)
            return@Column
        }

        ChoiceField("Did the child attend?", listOf(true, false), attended, { attended = it }) { if (it) "Attended" else "Absent" }
        if (attended) {
            DecimalField(label = "Weight (kg)", value = weight, onValueChange = { weight = it })
            ration?.let {
                if (it.bool("ok")) Text("Ration: ${it.str("packets_per_week")} packets a week (${it.str("packets_per_day")} a day) · ${it.str("source")}",
                    style = MaterialTheme.typography.bodyMedium, color = OtpGreen)
                else Text(it.str("reason").orEmpty(), style = MaterialTheme.typography.bodySmall, color = OtpAmber)
            }
            DecimalField(label = "Height / length (cm)", value = height, onValueChange = { height = it })
            DecimalField(label = "MUAC (cm)", value = muac, onValueChange = { muac = it })
            ChoiceField("Oedema", OEDEMA, oedema, { oedema = it }, ::oedemaLabel)
            DecimalField(label = "WFH Z-score (if used)", value = wfh, onValueChange = { wfh = it }, signed = true)
            ChoiceField("RUTF appetite test", listOf("good", "poor", "refused"), appetite, { appetite = it }) { it.replaceFirstChar(Char::uppercase) }
            Text("Medical history (number of days)", style = MaterialTheme.typography.titleSmall)
            NumberField(label = "Diarrhoea", value = diarrhoea, onValueChange = { diarrhoea = it })
            NumberField(label = "Vomiting", value = vomiting, onValueChange = { vomiting = it })
            NumberField(label = "Fever", value = fever, onValueChange = { fever = it })
            NumberField(label = "Cough", value = cough, onValueChange = { cough = it })
            Text("Physical examination", style = MaterialTheme.typography.titleSmall)
            DecimalField(label = "Temperature (°C)", value = temperature, onValueChange = { temperature = it })
            NumberField(label = "Respiratory rate (per minute)", value = respiratory, onValueChange = { respiratory = it })
            ChoiceField("Dehydrated", yesNo, dehydrated, { dehydrated = it }) { if (it) "Yes" else "No" }
            ChoiceField("Palmar pallor / anaemia", yesNo, pallor, { pallor = it }) { if (it) "Yes" else "No" }
            ChoiceField("Superficial infection", yesNo, infection, { infection = it }) { if (it) "Yes" else "No" }
            TpmTextField(label = "Action / medication required (details)", value = actionDetails, onValueChange = { actionDetails = it }, singleLine = false, minLines = 2)
            NumberField(label = "RUTF packets dispensed", value = dispensed, onValueChange = { dispensed = it })
            val perWeek = ration?.takeIf { it.bool("ok") }?.str("packets_per_week")?.toIntOrNull()
            val differs = perWeek != null && dispensed.toIntOrNull() != null && dispensed.toIntOrNull() != perWeek
            if (differs) TpmTextField(label = "Why it differs from the ration ($perWeek)", value = dispenseNote, onValueChange = { dispenseNote = it })
            TpmTextField(label = "Examiner's initials", value = initials, onValueChange = { initials = it })
        }

        val ready = !attended || (weight.toDoubleOrNull() != null && (dispenseNote.isNotBlank() ||
            ration?.takeIf { it.bool("ok") }?.str("packets_per_week")?.toIntOrNull().let { it == null || dispensed.toIntOrNull() == it }))
        TpmButton(
            text = if (busy) "Saving…" else if (attended) "Record the visit" else "Record the absence",
            enabled = ready && !busy, fullWidth = true, blueprint = true,
            onClick = {
                busy = true; error = null
                scope.launch {
                    val body = buildJsonObject {
                        put("child_code", childCode); put("attended", attended); put("client_id", clientId)
                        if (attended) {
                            weight.toDoubleOrNull()?.let { put("weight_kg", it) }; height.toDoubleOrNull()?.let { put("height_cm", it) }
                            muac.toDoubleOrNull()?.let { put("muac_cm", it) }; oedema?.let { put("oedema", it) }
                            wfh.toDoubleOrNull()?.let { put("wfh_z", it) }; appetite?.let { put("appetite_test", it) }
                            diarrhoea.toIntOrNull()?.let { put("diarrhoea_days", it) }; vomiting.toIntOrNull()?.let { put("vomiting_days", it) }
                            fever.toIntOrNull()?.let { put("fever_days", it) }; cough.toIntOrNull()?.let { put("cough_days", it) }
                            temperature.toDoubleOrNull()?.let { put("temperature_c", it) }; respiratory.toIntOrNull()?.let { put("respiratory_rate", it) }
                            dehydrated?.let { put("dehydrated", it) }; pallor?.let { put("pallor", it) }; infection?.let { put("superficial_infection", it) }
                            if (actionDetails.isNotBlank()) { put("action_required", true); put("action_details", actionDetails.trim()) }
                            dispensed.toIntOrNull()?.let { put("rutf_dispensed", it) }
                            if (dispenseNote.isNotBlank()) put("dispense_note", dispenseNote.trim())
                            if (initials.isNotBlank()) put("examiner_initials", initials.trim())
                        }
                    }
                    when (val r = repo.recordVisit(body)) {
                        is OtpResult.Ok -> saved = r.data
                        is OtpResult.Error -> error = r.message
                    }
                    busy = false
                }
            },
        )
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
        TpmButton(text = "Cancel", onClick = onExit, variant = TpmButtonVariant.Ghost, fullWidth = true)
        Text("Saved to the server only (needs a connection); nothing about the child is kept on this phone.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
    }
}
