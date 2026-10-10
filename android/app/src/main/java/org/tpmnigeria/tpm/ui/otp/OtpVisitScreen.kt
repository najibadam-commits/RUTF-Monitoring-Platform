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
import org.tpmnigeria.tpm.data.obj
import org.tpmnigeria.tpm.data.objects
import org.tpmnigeria.tpm.data.str
import org.tpmnigeria.tpm.data.strings
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.NumberField
import org.tpmnigeria.tpm.ui.stock.ReviewRow
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.util.UUID

/**
 * A visit (card C2): the admission visit (the RUTF given on the day of admission, measurements
 * from the admission) or a follow-up. The last measurements are shown first so the officer can
 * compare. The ration is read from the 92 g table at this visit's weight (RULEBOOK §6) and shown
 * as the weight is typed; the database applies it, compares the visit with the previous one and
 * the admission, applies the card's and booklet's rules (no RUTF recommended while a referral is
 * open, or with severe oedema or a poor appetite: G4), checks the RUTF given (a different quantity
 * needs a reason; RUTF when none is recommended needs the OTP Officer's reason, Q22), and schedules
 * the next visit. A visit where RUTF was given is complete once its photo is sent (web 0128).
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
    var card by remember { mutableStateOf<JsonObject?>(null) }
    var photoSent by remember { mutableStateOf(false) }
    val clientId = remember { UUID.randomUUID().toString() }

    // The child's card: is this the admission visit, what was measured last, is a referral open?
    LaunchedEffect(childCode) {
        when (val r = repo.lookup(childCode)) {
            is OtpResult.Ok -> card = r.data
            is OtpResult.Error -> error = r.message
        }
    }
    val admissionVisit = card?.obj("next_step")?.str("step") == "admission_visit"
    val openReferral = card?.arr("referrals")?.objects()?.any { it.str("status") in setOf("referred", "arrived") } == true
    val adm = card?.obj("admission")
    LaunchedEffect(admissionVisit) {
        if (admissionVisit && weight.isBlank()) adm?.let { a ->
            weight = a.str("weight_kg").orEmpty(); muac = a.str("muac_cm").orEmpty(); oedema = a.str("oedema") ?: "absent"
        }
    }

    // The ration for the typed weight, from the table (after a short pause in typing).
    LaunchedEffect(weight) {
        ration = null
        val w = weight.toDoubleOrNull() ?: return@LaunchedEffect
        delay(500)
        ration = (repo.ration(w) as? OtpResult.Ok)?.data
        val perWeek = ration?.takeIf { it.bool("ok") }?.str("packets_per_week")
        if (perWeek != null && dispensed.isBlank() && !openReferral && oedema != "+++" && appetite !in setOf("poor", "refused")) dispensed = perWeek
    }
    // No RUTF is recommended while a referral is open, or with severe oedema or a poor appetite (G4).
    val withheld = when {
        openReferral -> "the child is referred and the result is not recorded yet"
        oedema == "+++" -> "severe oedema (+++): refer to stabilisation care (G4)"
        appetite == "poor" || appetite == "refused" -> "poor or refused appetite test: refer to stabilisation care (G4)"
        else -> null
    }
    // Nothing is pre-filled when none is recommended: the officer enters 0, or what a clinician authorised.
    LaunchedEffect(withheld) { if (withheld != null && dispensed == ration?.str("packets_per_week")) dispensed = "" }

    val yesNo = listOf(false, true)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
    ) {
        Text((if (admissionVisit) "Admission visit · " else "Visit · ") + childCode, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        val done = saved
        if (done != null) {
            TpmCard(blueprint = true) {
                Text((if (done.str("visit_kind") == "admission") "Admission visit" else "Visit ${done.str("visit_number")}") + " recorded",
                    style = MaterialTheme.typography.titleMedium, color = OtpGreen)
                ReviewRow("RUTF", when (done.str("ration_status")) {
                    "withheld" -> "${done.str("rutf_given")} given · none recommended: ${done.str("withheld_reason")}"
                    "no_rule" -> "${done.str("rutf_given")} given · no ration rule for this weight"
                    null -> "Absent: none given"
                    else -> "${done.str("rutf_given")} given / ${done.obj("ration")?.str("packets_per_week")} recommended"
                })
                done.obj("next_step")?.let { ReviewRow("Next step", it.str("message").orEmpty()) }
                ReviewRow("Next visit", done.str("next_visit_due") ?: "not scheduled")
                BulletList("Alerts", done.arr("alerts").strings(), OtpAmber)
            }
            done.obj("recovery")?.takeIf { it.str("basis") == "compared" }?.let { ComparisonCard(it, "Compared with the previous visit") }
            if (done.str("record_status") == "awaiting_photo" && !photoSent) {
                RutfPhotoCapture(done.str("visit_id").orEmpty(), done.str("photo_folder").orEmpty(), done.str("rutf_given"), onDone = { photoSent = true })
                Text("The visit stays incomplete until the photo is sent. You can also send it later from Visits and tasks.",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            } else if (photoSent) {
                Text("Photo sent: the visit is complete.", color = OtpGreen, style = MaterialTheme.typography.bodyMedium)
            }
            TpmButton(text = "Back to the card", onClick = onDone, fullWidth = true)
            return@Column
        }

        // The last measurements, to compare before entering the new ones.
        card?.let { c ->
            val last = c.arr("visits").objects().lastOrNull { it.str("attended") != "false" }
            TpmCard {
                Text(if (last != null) "Last visit (${last.str("visit_on")})" else "At admission (${adm?.str("admitted_on")})",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                val src = last ?: adm
                Text("${src?.str("weight_kg") ?: "—"} kg · MUAC ${src?.str("muac_cm") ?: "—"} cm · oedema ${src?.str("oedema") ?: "—"}" +
                    (last?.let { " · RUTF ${it.str("rutf_dispensed") ?: "—"} given" } ?: ""), style = MaterialTheme.typography.bodyMedium)
                if (last != null) Text("At admission: ${adm?.str("weight_kg") ?: "—"} kg · MUAC ${adm?.str("muac_cm") ?: "—"} cm · oedema ${adm?.str("oedema") ?: "—"}",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                c.obj("next_visit")?.let { Text("Visit ${it.str("visit_number")} was due ${it.str("due_on")}", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
            }
            if (admissionVisit) Text("The admission visit records the RUTF given today; the measurements are the admission's.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }

        if (!admissionVisit) ChoiceField("Did the child attend?", listOf(true, false), attended, { attended = it }) { if (it) "Attended" else "Absent" }
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
            if (withheld != null) Text("No RUTF recommended: $withheld. As the OTP Officer you may still give RUTF, with the reason.",
                color = OtpRed, style = MaterialTheme.typography.bodyMedium)
            NumberField(label = "RUTF packets given", value = dispensed, onValueChange = { dispensed = it })
            val perWeek = ration?.takeIf { it.bool("ok") && withheld == null }?.str("packets_per_week")?.toIntOrNull()
            val noRecommendation = withheld != null || ration?.bool("ok") == false
            val differs = perWeek != null && dispensed.toIntOrNull() != null && dispensed.toIntOrNull() != perWeek
            if (differs) TpmTextField(label = "Why it differs from the ration ($perWeek)", value = dispenseNote, onValueChange = { dispenseNote = it })
            if (noRecommendation && (dispensed.toIntOrNull() ?: 0) > 0) {
                TpmTextField(label = "Reason RUTF is given (you authorise it as the OTP Officer)", value = dispenseNote, onValueChange = { dispenseNote = it })
            }
            if ((dispensed.toIntOrNull() ?: 0) > 0) Text("After saving, take a photo of the RUTF given (sachets only).",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            TpmTextField(label = "Examiner's initials", value = initials, onValueChange = { initials = it })
        }

        val given = dispensed.toIntOrNull()
        val noRec = withheld != null || ration?.bool("ok") == false
        val ready = card != null && (!attended || (weight.toDoubleOrNull() != null && given != null && when {
            noRec -> given == 0 || dispenseNote.isNotBlank()
            else -> dispenseNote.isNotBlank() || ration?.takeIf { it.bool("ok") }?.str("packets_per_week")?.toIntOrNull().let { it == null || given == it }
        }))
        TpmButton(
            text = if (busy) "Saving…" else if (admissionVisit) "Record the admission visit" else if (attended) "Record the visit" else "Record the absence",
            enabled = ready && !busy, fullWidth = true, blueprint = true,
            onClick = {
                busy = true; error = null
                scope.launch {
                    val body = buildJsonObject {
                        put("child_code", childCode); put("attended", attended || admissionVisit); put("client_id", clientId)
                        if (admissionVisit) put("admission_visit", true)
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
