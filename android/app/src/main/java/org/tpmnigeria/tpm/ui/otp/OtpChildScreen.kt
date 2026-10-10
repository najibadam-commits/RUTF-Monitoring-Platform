package org.tpmnigeria.tpm.ui.otp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
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
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.ReviewRow
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.util.UUID

/**
 * The digital OTP Admission Card for one child, opened by Child ID (RULEBOOK §4–§8): details,
 * the current admission, visits with the RUTF ration, routine medication due, the discharge check
 * and the outcome. Everything comes from otp_child_lookup() — only the OTP Officer at the child's
 * site gets it — and nothing is kept on the phone. Screenshots are blocked while it is open.
 */
@Composable
fun OtpChildScreen(childCode: String, onRecordVisit: (String) -> Unit, onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)
    SecureScreen()

    var card by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var ration by remember { mutableStateOf<JsonObject?>(null) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(childCode, reload) {
        error = null
        when (val r = repo.lookup(childCode)) {
            is OtpResult.Ok -> {
                card = r.data
                val adm = r.data.obj("admission")
                val lastWeight = r.data.arr("visits").objects().lastOrNull { it.str("weight_kg") != null }?.str("weight_kg") ?: adm?.str("weight_kg")
                ration = lastWeight?.toDoubleOrNull()?.let { (repo.ration(it) as? OtpResult.Ok)?.data }
            }
            is OtpResult.Error -> error = r.message
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
    ) {
        error?.let {
            TpmCard { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
            TpmButton(text = "Back", onClick = onExit, variant = TpmButtonVariant.Secondary, fullWidth = true)
        }
        val c = card ?: run { if (error == null) Text("Opening the card…", color = TpmColors.TextMuted); return@Column }
        val identity = c.obj("identity")
        val adm = c.obj("admission")
        val active = adm?.str("status") == "active"

        // The card itself: what the caregiver keeps (Child ID) and who the child is.
        TpmCard(blueprint = true) {
            Text("OTP Admission Card", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            Text(c.str("child_code").orEmpty(), fontFamily = FontFamily.Monospace, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text(identity?.str("child_name").orEmpty(), style = MaterialTheme.typography.titleMedium)
            ReviewRow("Sex", if (c.str("sex") == "F") "Girl" else "Boy")
            ReviewRow("Age at registration", "${c.str("age_months_at_registration")} months")
            identity?.str("caregiver_name")?.let { ReviewRow("Caregiver", it) }
            identity?.str("physical_address")?.let { ReviewRow("Address", it) }
            identity?.str("mobile_number")?.let { ReviewRow("Mobile", it) }
            Text("Write the Child ID on the caregiver's paper card: it opens this record at the next visit.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }

        if (adm != null) TpmCard {
            Text(if (active) "Under treatment" else "Admission closed: ${OUTCOME_LABEL[adm.str("outcome")] ?: adm.str("outcome")}",
                style = MaterialTheme.typography.titleMedium, color = if (active) OtpGreen else TpmColors.Text)
            ReviewRow("Admitted", adm.str("admitted_on").orEmpty())
            ReviewRow("Type", ADMISSION_TYPE_LABEL[adm.str("admission_type")] ?: adm.str("admission_type").orEmpty())
            ReviewRow("Admitted on", adm.arr("admission_criteria").strings().joinToString { it.uppercase() }.ifEmpty { "—" })
            ReviewRow("At admission", "${adm.str("weight_kg") ?: "—"} kg · MUAC ${adm.str("muac_cm") ?: "—"} cm · oedema ${adm.str("oedema") ?: "—"}")
            ration?.let { rt ->
                if (rt.bool("ok")) ReviewRow("RUTF ration", "${rt.str("packets_per_week")} packets a week (${rt.str("packets_per_day")} a day) · ${rt.str("source")}")
                else Text(rt.str("reason").orEmpty(), color = OtpAmber, style = MaterialTheme.typography.bodySmall)
            }
            if (active) TpmButton(text = "Record a visit", onClick = { onRecordVisit(c.str("child_code").orEmpty()) }, fullWidth = true, blueprint = true)
        }

        // Visits (card C2).
        val visits = c.arr("visits").objects()
        if (visits.isNotEmpty()) TpmCard {
            Text("Visits", style = MaterialTheme.typography.titleMedium)
            visits.forEach { v ->
                val line = if (v.str("attended") == "false") "Absent"
                else "${v.str("weight_kg")} kg · MUAC ${v.str("muac_cm") ?: "—"} · oedema ${v.str("oedema") ?: "—"} · RUTF ${v.str("rutf_dispensed") ?: "—"}/${v.str("rutf_prescribed") ?: "—"}"
                ReviewRow("Visit ${v.str("visit_number")} · ${v.str("visit_on")}", line)
                v.arr("alerts").strings().forEach { Text("⚠ $it", color = OtpAmber, style = MaterialTheme.typography.bodySmall) }
            }
        }

        if (active) MedicationCard(c, onRecorded = { reload++ })
        if (active) DischargeCard(c, onDone = { toast.show("Outcome recorded"); reload++ })
    }
}

/** Routine medication (G6): what is due and what is recorded. Doses are entered, never calculated. */
@Composable
private fun MedicationCard(card: JsonObject, onRecorded: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf<String?>(null) }
    var dose by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val code = card.str("child_code").orEmpty()

    fun record(medication: String, status: String) {
        error = null
        scope.launch {
            val body = buildJsonObject {
                put("child_code", code); put("medication", medication); put("status", status)
                if (dose.isNotBlank()) put("dose_text", dose.trim()); if (reason.isNotBlank()) put("reason", reason.trim())
                put("client_id", UUID.randomUUID().toString())
            }
            when (val r = repo.recordMedication(body)) {
                is OtpResult.Ok -> { open = null; dose = ""; reason = ""; onRecorded() }
                is OtpResult.Error -> error = r.message
            }
        }
    }

    TpmCard {
        Text("Routine medication", style = MaterialTheme.typography.titleMedium)
        card.arr("due_medications").objects().forEach { m ->
            val key = m.str("medication").orEmpty()
            val recorded = m.str("recorded")
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(m.str("label").orEmpty(), style = MaterialTheme.typography.bodyLarge)
                Text("${m.str("when")} · ${m.str("source")}", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                m.str("note")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = OtpAmber) }
                when {
                    m.bool("pending_rule") -> Text("Not available until the clinical authority signs it off.", style = MaterialTheme.typography.bodySmall, color = OtpAmber)
                    recorded != null -> Text("Recorded: ${recorded.replace('_', ' ')}", style = MaterialTheme.typography.bodySmall, color = OtpGreen)
                    open == key -> {
                        if (key != "malaria_test") TpmTextField(label = "Dose given (as prescribed)", value = dose, onValueChange = { dose = it })
                        TpmTextField(label = "Note (reason if not given)", value = reason, onValueChange = { reason = it })
                        Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                            if (key == "malaria_test") {
                                TpmButton(text = "Positive", onClick = { record(key, "test_positive") })
                                TpmButton(text = "Negative", onClick = { record(key, "test_negative") }, variant = TpmButtonVariant.Secondary)
                            } else {
                                TpmButton(text = "Given", onClick = { record(key, "given") }, enabled = dose.isNotBlank())
                                TpmButton(text = "Not given", onClick = { record(key, "not_given") }, variant = TpmButtonVariant.Secondary, enabled = reason.isNotBlank())
                                TpmButton(text = "Already given", onClick = { record(key, "already_given") }, variant = TpmButtonVariant.Ghost)
                            }
                        }
                    }
                    else -> TpmButton(text = "Record", onClick = { open = key; dose = ""; reason = "" }, variant = TpmButtonVariant.Ghost)
                }
            }
        }
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
    }
}

/** Discharge as cured (G7) and the other outcomes (C2): each criterion met / not met / pending. */
@Composable
private fun DischargeCard(card: JsonObject, onDone: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    var outcome by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var clinicallyWell by remember { mutableStateOf(false) }
    var weightGain by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val check = card.obj("discharge_check")
    val canCure = check?.bool("can_discharge_as_cured") == true
    val muacAdmission = card.obj("admission")?.arr("admission_criteria")?.strings()?.contains("muac") == true

    TpmCard {
        Text("Discharge and outcome", style = MaterialTheme.typography.titleMedium)
        check?.arr("criteria")?.objects()?.forEach { c ->
            val state = c.str("state")
            val (mark, colour) = when (state) {
                "met" -> "✓ met" to OtpGreen
                "not_met" -> "✗ not met" to OtpRed
                "officer_confirms" -> "you confirm" to OtpAmber
                else -> "… pending" to TpmColors.TextMuted
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(c.str("criterion").orEmpty(), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(mark, color = colour, style = MaterialTheme.typography.bodySmall)
            }
        }
        check?.let { RuleStatus(it) }
        TpmDropdown(label = "Outcome", selected = outcome,
            options = listOf("cured", "defaulted", "died", "non_recovered", "transferred_inpatient", "refused_inpatient"),
            onSelect = { outcome = it }, labelFor = { OUTCOME_LABEL[it] ?: it })
        if (outcome == "cured") {
            if (!canCure) Text("Not every criterion is met yet: discharge as cured isn't possible.", color = OtpRed, style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked = clinicallyWell, onCheckedChange = { clinicallyWell = it }); Text("The child is clinically well") }
            if (muacAdmission) Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked = weightGain, onCheckedChange = { weightGain = it }); Text("Sustained weight gain") }
        } else if (outcome != null) {
            TpmTextField(label = "Reason", value = reason, onValueChange = { reason = it })
        }
        val ready = when (outcome) {
            null -> false
            "cured" -> canCure && clinicallyWell && (!muacAdmission || weightGain)
            else -> reason.isNotBlank()
        }
        TpmButton(text = "Record the outcome", enabled = ready, fullWidth = true, variant = TpmButtonVariant.Secondary, onClick = {
            error = null
            scope.launch {
                val body = buildJsonObject {
                    put("child_code", card.str("child_code").orEmpty()); put("outcome", outcome!!)
                    if (reason.isNotBlank()) put("reason", reason.trim())
                    put("confirm_clinically_well", clinicallyWell); put("confirm_weight_gain", weightGain)
                }
                when (val r = repo.recordOutcome(body)) {
                    is OtpResult.Ok -> onDone()
                    is OtpResult.Error -> error = r.message
                }
            }
        })
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
    }
}
