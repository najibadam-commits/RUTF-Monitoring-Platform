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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmDropdown
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.NumberField
import org.tpmnigeria.tpm.ui.stock.ReviewRow
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.time.LocalDate
import java.util.UUID

/**
 * The two minimal forms the weekly report needs because nothing recorded them before
 * (RUTF DECISIONS R147, R149): MNP stock movements and doses given, and IYCF / health education
 * sessions. Totals only, no names. Saved to the server (needs a connection).
 */
@Composable
fun OtpMnpScreen(onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)

    var date by remember { mutableStateOf(LocalDate.now()) }
    var kind by remember { mutableStateOf<String?>(null) }
    var sachets by remember { mutableStateOf("") }
    var negative by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var event by remember { mutableStateOf<String?>(null) }
    var children by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val kinds = listOf("receipt", "distributed", "loss", "adjustment", "physical_count")
    fun kindLabel(k: String) = when (k) {
        "receipt" -> "Received"; "distributed" -> "Distributed (other than children started below)"; "loss" -> "Lost or damaged"
        "adjustment" -> "Adjustment (with reason)"; else -> "Physical count (what is on the shelf)"
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3)) {
        Text("MNP (micronutrient powders)", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text("A child whose MUAC is yellow gets 3 boxes (90 sachets) at once, for 3 months, and comes back after 3 months. Stock is counted in sachets (150 a carton, 30 a box).",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        DatePickerField(label = "Date", date = date, onDateChange = { date = it })
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }

        TpmCard {
            Text("Stock movement", style = MaterialTheme.typography.titleMedium)
            TpmDropdown(label = "What happened", selected = kind, options = kinds, onSelect = { kind = it }, labelFor = ::kindLabel)
            NumberField(label = "Sachets", value = sachets, onValueChange = { sachets = it })
            if (kind == "adjustment") ChoiceField("Direction", listOf(false, true), negative, { negative = it }) { if (it) "Remove" else "Add" }
            if (kind == "adjustment" || kind == "loss") TpmTextField(label = "Reason", value = note, onValueChange = { note = it })
            TpmButton(text = "Record the stock movement", fullWidth = true,
                enabled = !busy && kind != null && sachets.toIntOrNull() != null && (kind != "adjustment" || note.isNotBlank()),
                onClick = {
                    busy = true; error = null
                    scope.launch {
                        val q = sachets.toInt().let { if (kind == "adjustment" && negative) -it else it }
                        val body = buildJsonObject {
                            put("movement_date", date.toString()); put("kind", kind!!); put("sachets", q)
                            if (note.isNotBlank()) put("note", note.trim()); put("client_id", UUID.randomUUID().toString())
                        }
                        when (val r = repo.recordMnpStock(body)) {
                            is OtpResult.Ok -> { toast.show("MNP ${kindLabel(kind!!).lowercase()}: $q sachets recorded"); sachets = ""; note = "" }
                            is OtpResult.Error -> error = r.message
                        }
                        busy = false
                    }
                })
        }

        TpmCard {
            Text("Children", style = MaterialTheme.typography.titleMedium)
            ChoiceField("What happened", listOf("started", "follow_up"), event, { event = it }) { if (it == "started") "Started on MNP (3 boxes each)" else "Back for the 3-month follow-up" }
            NumberField(label = "Number of children", value = children, onValueChange = { children = it })
            if (event == "started") children.toIntOrNull()?.let {
                Text("${it * 90} sachets (${it * 3} boxes) go out of stock automatically.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
            TpmButton(text = "Record the children", fullWidth = true, enabled = !busy && event != null && children.toIntOrNull() != null, onClick = {
                busy = true; error = null
                scope.launch {
                    val body = buildJsonObject {
                        put("given_on", date.toString()); put("event", event!!); put("children", children.toInt()); put("client_id", UUID.randomUUID().toString())
                    }
                    when (val r = repo.recordMnpDoses(body)) {
                        is OtpResult.Ok -> { toast.show(if (event == "started") "$children child(ren) started on MNP" else "$children child(ren) back for follow-up"); children = "" }
                        is OtpResult.Error -> error = r.message
                    }
                    busy = false
                }
            })
        }
    }
}

@Composable
fun OtpIycfScreen(onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)

    var date by remember { mutableStateOf(LocalDate.now()) }
    var kind by remember { mutableStateOf<String?>(null) }
    var topic by remember { mutableStateOf("") }
    var pregnant by remember { mutableStateOf("") }
    var breastfeeding by remember { mutableStateOf("") }
    var other by remember { mutableStateOf("") }
    var total by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3)) {
        Text("IYCF / health education session", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text("One entry per session. The groups do not overlap; the total is the attendance (a woman who comes twice counts twice).",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        DatePickerField(label = "Date", date = date, onDateChange = { date = it })
        TpmDropdown(label = "Session", selected = kind, options = listOf("iycf_support_group", "health_education"), onSelect = { kind = it },
            labelFor = { if (it == "iycf_support_group") "IYCF support group" else "Health education" })
        TpmTextField(label = "Topic", value = topic, onValueChange = { topic = it })
        NumberField(label = "Pregnant women", value = pregnant, onValueChange = { pregnant = it })
        NumberField(label = "Breastfeeding women", value = breastfeeding, onValueChange = { breastfeeding = it })
        NumberField(label = "Other women", value = other, onValueChange = { other = it })
        // W8: with the groups entered, the total is their sum; otherwise enter the attendance.
        val groupSum = listOf(pregnant, breastfeeding, other).mapNotNull { it.toIntOrNull() }.takeIf { it.isNotEmpty() }?.sum()
        if (groupSum != null) ReviewRow("Total attendance", "$groupSum")
        else NumberField(label = "Total attendance at the session", value = total, onValueChange = { total = it })
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
        TpmButton(text = "Record the session", fullWidth = true, blueprint = true, enabled = !busy && kind != null && (groupSum != null || total.toIntOrNull() != null), onClick = {
            busy = true; error = null
            scope.launch {
                val body = buildJsonObject {
                    put("held_on", date.toString()); put("kind", kind!!); if (topic.isNotBlank()) put("topic", topic.trim())
                    pregnant.toIntOrNull()?.let { put("pregnant_women", it) }; breastfeeding.toIntOrNull()?.let { put("breastfeeding_women", it) }
                    other.toIntOrNull()?.let { put("other_women", it) }; put("total_participants", groupSum ?: total.toInt()); put("client_id", UUID.randomUUID().toString())
                }
                when (val r = repo.recordIycfSession(body)) {
                    is OtpResult.Ok -> { toast.show("Session recorded"); onExit() }
                    is OtpResult.Error -> error = r.message
                }
                busy = false
            }
        })
    }
}
