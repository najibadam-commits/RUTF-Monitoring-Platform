package org.tpmnigeria.tpm.ui.otp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.NumberField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.util.UUID

/**
 * Screening and registration (RULEBOOK §1–§4). The officer records the measurements and checks;
 * the database's engine (otp_screen) decides the classification and pathway from the approved
 * rules and never guesses: missing or implausible inputs block the decision, and the booklet's
 * open points go to clinical review. Only a child whose pathway is OTP can be registered, and the
 * Child ID is issued by the server.
 */
@Composable
fun OtpScreeningScreen(onRegistered: (String) -> Unit, onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)
    SecureScreen()

    // Screening inputs (card C1: anthropometry, admission criteria, history).
    var sex by remember { mutableStateOf<String?>(null) }
    var age by remember { mutableStateOf("") }
    var weight by remember { mutableStateOf("") }
    var height by remember { mutableStateOf("") }
    var muac by remember { mutableStateOf("") }
    var oedema by remember { mutableStateOf<String?>(null) }
    var wfh by remember { mutableStateOf("") }
    var complications by remember { mutableStateOf<Boolean?>(null) }
    var appetite by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<JsonObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Registration (card C1: details), only once the pathway is OTP.
    var childName by remember { mutableStateOf("") }
    var caregiver by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var source by remember { mutableStateOf<String?>(null) }
    var walking by remember { mutableStateOf("") }
    var readmission by remember { mutableStateOf(false) }
    var relapse by remember { mutableStateOf(false) }
    var duplicates by remember { mutableStateOf<List<String>>(emptyList()) }
    var confirmNotDuplicate by remember { mutableStateOf(false) }
    val registerClientId = remember { UUID.randomUUID().toString() }

    fun screeningBody() = buildJsonObject {
        sex?.let { put("sex", it) }
        age.toIntOrNull()?.let { put("age_months", it) }
        weight.toDoubleOrNull()?.let { put("weight_kg", it) }
        height.toDoubleOrNull()?.let { put("height_cm", it) }
        muac.toDoubleOrNull()?.let { put("muac_cm", it) }
        oedema?.let { put("oedema", it) }
        wfh.toDoubleOrNull()?.let { put("wfh_z", it) }
        complications?.let { put("medical_complications", it) }
        appetite?.let { put("appetite_test", it) }
        put("client_id", UUID.randomUUID().toString()) // each evaluation is its own screening record
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
    ) {
        Text("Screening", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text("Children 6–59 months. Measure MUAC on the left arm to 0.1 cm; check both feet for pitting oedema for 3 seconds.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)

        ChoiceField("Sex", listOf("F", "M"), sex, { sex = it; result = null }) { if (it == "F") "Girl" else "Boy" }
        NumberField(label = "Age (months)", value = age, onValueChange = { age = it; result = null })
        DecimalField(label = "Weight (kg)", value = weight, onValueChange = { weight = it; result = null })
        DecimalField(label = "Height / length (cm)", value = height, onValueChange = { height = it; result = null })
        DecimalField(label = "MUAC (cm)", value = muac, onValueChange = { muac = it; result = null })
        ChoiceField("Bilateral pitting oedema", OEDEMA, oedema, { oedema = it; result = null }, ::oedemaLabel)
        DecimalField(label = "Weight-for-height Z-score (only if this site uses WFH)", value = wfh, onValueChange = { wfh = it; result = null }, signed = true)
        ChoiceField("Medical complications (danger signs)", listOf(false, true), complications, { complications = it; result = null }) { if (it) "Yes" else "No" }
        ChoiceField("Appetite test for RUTF", listOf("pass", "fail"), appetite, { appetite = it; result = null }) { if (it == "pass") "Passed" else "Failed" }

        TpmButton(
            text = if (busy && result == null) "Checking…" else "Check the pathway",
            enabled = !busy, fullWidth = true, blueprint = true,
            onClick = {
                busy = true; error = null
                scope.launch {
                    when (val r = repo.screen(screeningBody())) {
                        is OtpResult.Ok -> result = r.data
                        is OtpResult.Error -> error = r.message
                    }
                    busy = false
                }
            },
        )
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
        result?.let { PathwayResultCard(it) }

        val screeningId = result?.str("screening_id")
        if (result?.str("pathway") == "otp" && screeningId != null) {
            Text("Register the child", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("These details are seen only by the OTP Officer at this site, by entering the Child ID.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            TpmTextField(label = "Child's name", value = childName, onValueChange = { childName = it; duplicates = emptyList() })
            TpmTextField(label = "Caregiver's name", value = caregiver, onValueChange = { caregiver = it; duplicates = emptyList() })
            TpmTextField(label = "Physical address", value = address, onValueChange = { address = it })
            TpmTextField(label = "Mobile number", value = phone, onValueChange = { phone = it })
            TpmDropdown(label = "Admission", selected = source, options = listOf("community", "self", "other_centre", "inpatient"),
                onSelect = { source = it }, labelFor = {
                    when (it) { "community" -> "Referral from community"; "self" -> "Self-referral"; "other_centre" -> "From other centre"; else -> "From inpatient" }
                })
            DecimalField(label = "Walking distance to home (hours)", value = walking, onValueChange = { walking = it })
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = readmission, onCheckedChange = { readmission = it }); Text("Readmission")
                Checkbox(checked = relapse, onCheckedChange = { relapse = it }); Text("Relapse")
            }
            if (duplicates.isNotEmpty()) {
                TpmCard {
                    Text("Possible duplicate", style = MaterialTheme.typography.titleSmall, color = OtpAmber)
                    Text("A child with the same name, caregiver, sex and age is already registered in this LGA: ${duplicates.joinToString()}. " +
                        "Open that Child ID to check. Register again only if this is a different child.", style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = confirmNotDuplicate, onCheckedChange = { confirmNotDuplicate = it })
                        Text("I have checked: this is a different child")
                    }
                }
            }
            val ready = childName.isNotBlank() && sex != null && source != null && (duplicates.isEmpty() || confirmNotDuplicate)
            TpmButton(
                text = if (busy) "Registering…" else "Register and issue the Child ID",
                enabled = ready && !busy, fullWidth = true,
                onClick = {
                    busy = true; error = null
                    scope.launch {
                        val body = buildJsonObject {
                            put("screening_id", screeningId); put("child_name", childName.trim()); put("caregiver_name", caregiver.trim())
                            put("physical_address", address.trim()); put("mobile_number", phone.trim()); put("sex", sex!!)
                            put("admission_source", source!!); walking.toDoubleOrNull()?.let { put("walking_hours", it) }
                            put("readmission", readmission); put("relapse", relapse)
                            put("confirm_not_duplicate", confirmNotDuplicate); put("client_id", registerClientId)
                        }
                        when (val r = repo.register(body)) {
                            is OtpResult.Ok -> if (r.data.bool("possible_duplicate")) {
                                duplicates = r.data.arr("child_codes").strings()
                            } else {
                                val code = r.data.str("child_code")
                                if (code != null) { toast.show("Registered: Child ID $code"); onRegistered(code) }
                            }
                            is OtpResult.Error -> error = r.message
                        }
                        busy = false
                    }
                },
            )
            if (!ready) Text("Enter the child's name and how they came to the OTP site.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        } else if (result != null && result?.str("pathway") != "otp") {
            TpmButton(text = "Done", onClick = onExit, variant = TpmButtonVariant.Secondary, fullWidth = true)
        }
    }
}
