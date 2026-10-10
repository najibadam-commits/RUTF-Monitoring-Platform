package org.tpmnigeria.tpm.ui.otp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Inventory
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.data.arr
import org.tpmnigeria.tpm.data.obj
import org.tpmnigeria.tpm.data.objects
import org.tpmnigeria.tpm.data.str
import org.tpmnigeria.tpm.ui.components.DatePickerField
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.components.modal.CameraCaptureModal
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.ReviewRow
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import org.tpmnigeria.tpm.ui.wizard.common.PhotoCaptureStep
import java.time.LocalDate
import java.util.UUID

/*
 * OTP follow-up (web migration 0128; RUTF DECISIONS R150–R153): the next step and the next visit,
 * the comparison with the admission and the previous visit, referrals, the photo of the RUTF given,
 * and the OTP Officer's visits list (Child IDs only). Everything is decided on the server.
 */

private val COMPARISON_LABEL = mapOf(
    "improved" to "Improved since the previous visit",
    "unchanged" to "No change since the previous visit",
    "deteriorated" to "Worse since the previous visit",
    "baseline" to "Baseline: the admission measurements",
    "not_assessed" to "Not enough measurements to compare",
)

private fun comparisonColour(state: String?): Color = when (state) {
    "improved" -> OtpGreen
    "deteriorated" -> OtpRed
    "unchanged" -> OtpAmber
    else -> TpmColors.TextMuted
}

private fun stepColour(step: String?): Color = when (step) {
    "continue" -> OtpGreen
    "refer", "awaiting_referral", "record_outcome" -> OtpRed
    "closed" -> TpmColors.TextMuted
    else -> OtpAmber
}

private fun arrow(direction: String?): String = when (direction) {
    "better" -> "▲ better"
    "worse" -> "▼ worse"
    "same" -> "= same"
    else -> ""
}

/** What happens next for this child, and the next visit (with rescheduling, which needs a reason). */
@Composable
fun NextStepCard(card: JsonObject, onChanged: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    val next = card.obj("next_step") ?: return
    val step = next.str("step")
    val visit = card.obj("next_visit")
    var open by remember { mutableStateOf(false) }
    var date by remember { mutableStateOf(LocalDate.now().plusDays(1)) }
    var reason by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    TpmCard(blueprint = true) {
        Text("Next step", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Text(next.str("message").orEmpty(), style = MaterialTheme.typography.titleSmall, color = stepColour(step), fontWeight = FontWeight.SemiBold)
        if (visit != null) {
            val overdue = visit.str("overdue") == "true"
            ReviewRow("Next visit (visit ${visit.str("visit_number")})",
                visit.str("due_on").orEmpty() + if (overdue) " · overdue" else "")
            visit.str("reason")?.let { Text("Rescheduled: $it", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
        } else if (step != "closed") {
            Text("No routine visit is scheduled.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }
        val canSchedule = step != "closed" && step != "awaiting_referral" && step != "admission_visit"
        if (canSchedule && !open) {
            TpmButton(text = if (visit != null) "Change the visit date" else "Schedule a visit", variant = TpmButtonVariant.Ghost, onClick = { open = true })
        }
        if (open) {
            DatePickerField(label = "New visit date", date = date, onDateChange = { date = it }, future = true)
            TpmTextField(label = "Reason (required)", value = reason, onValueChange = { reason = it })
            Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                TpmButton(text = "Save", enabled = reason.isNotBlank(), onClick = {
                    error = null
                    scope.launch {
                        val body = buildJsonObject { put("child_code", card.str("child_code").orEmpty()); put("due_on", date.toString()); put("reason", reason.trim()) }
                        when (val r = repo.reschedule(body)) {
                            is OtpResult.Ok -> { open = false; reason = ""; onChanged() }
                            is OtpResult.Error -> error = r.message
                        }
                    }
                })
                TpmButton(text = "Cancel", variant = TpmButtonVariant.Ghost, onClick = { open = false })
            }
        }
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
    }
}

/**
 * The comparison made by the server: each measurement against the previous visit and the
 * admission, with the direction of change, and the flags from the booklet and the card.
 */
@Composable
fun ComparisonCard(comparison: JsonObject, title: String = "Recovery: latest visit") {
    val vsPrev = comparison.str("vs_previous")
    TpmCard {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(COMPARISON_LABEL[vsPrev] ?: vsPrev.orEmpty(), color = comparisonColour(vsPrev), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        comparison.str("vs_baseline")?.takeIf { it != "baseline" }?.let {
            Text("Since admission: " + (COMPARISON_LABEL[it] ?: it).replace(" since the previous visit", "").lowercase(),
                color = comparisonColour(it), style = MaterialTheme.typography.bodyMedium)
        }
        comparison.arr("measures").objects().forEach { m ->
            val unit = m.str("unit").let { if (it == "grade") "" else " $it" }
            val prev = m.str("previous")
            val change = m.str("change_from_previous")?.let { c -> (if (!c.startsWith("-")) "+" else "") + c + unit }
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(m.str("label").orEmpty(), style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                    Text(
                        "admission ${m.str("baseline") ?: "—"} · previous ${prev ?: "—"} · now ${m.str("current") ?: "—"}$unit" + (change?.let { " ($it)" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Text(arrow(m.str("vs_previous")), style = MaterialTheme.typography.bodySmall,
                    color = when (m.str("vs_previous")) { "better" -> OtpGreen; "worse" -> OtpRed; else -> TpmColors.TextMuted })
            }
        }
        comparison.arr("flags").objects().forEach { f ->
            Text("⚠ ${f.str("message")}", color = if (f.str("withhold_ration") == "true") OtpRed else OtpAmber, style = MaterialTheme.typography.bodySmall)
        }
        comparison.str("note")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
    }
}

/** Every visit in order, from the admission: the measurements and the RUTF recommended and given. */
@Composable
fun TrajectoryCard(trajectory: JsonArray) {
    val rows = trajectory.objects()
    if (rows.size < 2) return
    TpmCard {
        Text("Progress since admission", style = MaterialTheme.typography.titleMedium)
        rows.forEach { t ->
            val label = if (t.str("visit") == "admission") "Admission" else "Visit ${t.str("visit")}"
            val line = if (t.str("attended") == "false") "Absent" else
                "${t.str("weight_kg") ?: "—"} kg · MUAC ${t.str("muac_cm") ?: "—"} · oedema ${t.str("oedema") ?: "—"}" +
                    (if (t.containsKey("rutf_given")) " · RUTF ${t.str("rutf_given") ?: "—"} given / ${t.str("rutf_recommended") ?: "none"} recommended" else "")
            ReviewRow("$label · ${t.str("date") ?: ""}", line)
        }
    }
}

/** An open referral (record what happened) or a new referral (reason and where to). */
@Composable
fun ReferralCard(card: JsonObject, onChanged: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    val referrals = card.arr("referrals").objects()
    val openRef = referrals.lastOrNull { it.str("status") in setOf("referred", "arrived") }
    val step = card.obj("next_step")?.str("step")
    val flags = card.obj("latest_comparison")?.arr("flags")?.objects().orEmpty()
    var start by remember { mutableStateOf(false) }
    var reason by remember(flags) { mutableStateOf(flags.filter { it.str("action") == "refer" }.joinToString("; ") { it.str("message").orEmpty() }) }
    var destination by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val clientId = remember { UUID.randomUUID().toString() }

    if (openRef == null && step != "refer" && !start && referrals.isEmpty()) {
        TpmButton(text = "Refer the child", variant = TpmButtonVariant.Ghost, fullWidth = true, onClick = { start = true })
        return
    }
    TpmCard {
        Text("Referral", style = MaterialTheme.typography.titleMedium)
        referrals.forEach { r ->
            ReviewRow("${r.str("referred_on")} → ${r.str("destination")}", "${r.str("status")?.replaceFirstChar(Char::uppercase)} · ${r.str("reason")}" +
                (r.str("status_note")?.let { " · $it" } ?: ""))
        }
        if (openRef != null) {
            Text("What happened?", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            TpmTextField(label = "Note (the clinician's advice, or why it was refused or closed)", value = note, onValueChange = { note = it })
            fun update(status: String) {
                error = null
                scope.launch {
                    when (val r = repo.updateReferral(openRef.str("id").orEmpty(), status, note.trim())) {
                        is OtpResult.Ok -> { note = ""; onChanged() }
                        is OtpResult.Error -> error = r.message
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                if (openRef.str("status") == "referred") TpmButton(text = "Arrived", variant = TpmButtonVariant.Secondary, onClick = { update("arrived") })
                TpmButton(text = "Back at the OTP", enabled = note.isNotBlank(), onClick = { update("returned") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                TpmButton(text = "Refused", variant = TpmButtonVariant.Ghost, enabled = note.isNotBlank(), onClick = { update("refused") })
                TpmButton(text = "Closed", variant = TpmButtonVariant.Ghost, enabled = note.isNotBlank(), onClick = { update("closed") })
            }
            Text("If the child is admitted as an inpatient, also record the outcome below.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        } else if (step == "refer" || start) {
            if (step == "refer") Text("The rules ask for a referral: no RUTF is recommended until it is recorded.", color = OtpRed, style = MaterialTheme.typography.bodySmall)
            TpmTextField(label = "Reason", value = reason, onValueChange = { reason = it }, singleLine = false, minLines = 2)
            TpmTextField(label = "Referred to (hospital or stabilisation centre)", value = destination, onValueChange = { destination = it })
            TpmButton(text = "Record the referral", fullWidth = true, enabled = reason.isNotBlank() && destination.isNotBlank(), onClick = {
                error = null
                scope.launch {
                    val body = buildJsonObject {
                        put("child_code", card.str("child_code").orEmpty()); put("reason", reason.trim()); put("destination_name", destination.trim())
                        putJsonArray("triggers") { flags.filter { it.str("action") == "refer" }.forEach { add(JsonPrimitive(it.str("code").orEmpty())) } }
                        put("client_id", clientId)
                    }
                    when (val r = repo.refer(body)) {
                        is OtpResult.Ok -> { start = false; onChanged() }
                        is OtpResult.Error -> error = r.message
                    }
                }
            })
        }
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
    }
}

/**
 * The photo of the RUTF given, required whenever RUTF is handed over (the user's decision, 10 Oct).
 * Sachets only: the officer confirms no child or caregiver is in the frame. Uploaded to the private
 * bucket, attached to the visit, then deleted from the phone.
 */
@Composable
fun RutfPhotoCapture(visitId: String, folder: String, rutfGiven: String?, onDone: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    var photo by remember { mutableStateOf<String?>(null) }
    var noPeople by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    TpmCard {
        Text("Photo of the RUTF given", style = MaterialTheme.typography.titleMedium)
        Text("Required to complete the visit${rutfGiven?.let { " ($it packets)" } ?: ""}. Photograph the sachets only.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        PhotoCaptureStep(label = "RUTF sachets", hint = "No child or caregiver in the frame.", photoPath = photo,
            icon = Icons.Filled.Inventory, onOpenCamera = { camera = true })
        if (photo != null) Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = noPeople, onCheckedChange = { noPeople = it })
            Text("No child or caregiver is in this photo", style = MaterialTheme.typography.bodyMedium)
        }
        TpmButton(text = if (busy) "Sending…" else "Send the photo", fullWidth = true, blueprint = true, enabled = photo != null && noPeople && !busy, onClick = {
            busy = true; error = null
            scope.launch {
                when (val r = repo.uploadRutfPhoto(visitId, folder, photo!!)) {
                    is OtpResult.Ok -> onDone()
                    is OtpResult.Error -> error = r.message
                }
                busy = false
            }
        })
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
    }
    if (camera) {
        CameraCaptureModal(title = "RUTF sachets (no people)", useFrontCamera = false, onDismiss = { camera = false },
            onPhotoCaptured = { photo = it; noPeople = false; camera = false })
    }
}

/** A visit waiting for its photo, opened from the visits list. */
@Composable
fun OtpPhotoScreen(visitId: String, folder: String, childCode: String, onExit: () -> Unit) {
    val toast = LocalToast.current
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3)) {
        Text("RUTF photo · $childCode", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        RutfPhotoCapture(visitId, folder, null, onDone = { toast.show("Photo sent: the visit is complete"); onExit() })
    }
}

/**
 * The OTP Officer's visits list: overdue, today, upcoming, photos to send, admission visits to
 * record, open referrals and children needing a decision. Child IDs only (no names, caregivers,
 * addresses or phones): a child's card opens only by its Child ID. The server logs each view.
 */
@Composable
fun OtpVisitsListScreen(onOpenChild: (String) -> Unit, onPhoto: (visitId: String, folder: String, childCode: String) -> Unit, onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        error = null
        when (val r = repo.myVisits()) {
            is OtpResult.Ok -> data = r.data
            is OtpResult.Error -> error = r.message
        }
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3)) {
        Text("Visits and tasks", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text("Child IDs only. Tap one to open the child's card.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
        val d = data ?: run { if (error == null) Text("Loading…", color = TpmColors.TextMuted); return@Column }
        val due = d.arr("due").objects()
        TaskSection("Overdue", OtpRed, due.filter { it.str("state") == "overdue" }) {
            TaskRow(it.str("child_code").orEmpty(), "Visit ${it.str("visit_number")} was due ${it.str("due_on")} (${it.str("days_overdue")} days ago)", onOpenChild)
        }
        TaskSection("Due today", OtpAmber, due.filter { it.str("state") == "today" }) {
            TaskRow(it.str("child_code").orEmpty(), "Visit ${it.str("visit_number")}", onOpenChild)
        }
        TaskSection("Photo of the RUTF to send", OtpAmber, d.arr("awaiting_photo").objects()) {
            val code = it.str("child_code").orEmpty()
            TaskRow(code, "Visit ${it.str("visit_number")} on ${it.str("visit_on")} · ${it.str("rutf_given")} packets") { _ ->
                onPhoto(it.str("visit_id").orEmpty(), it.str("photo_folder").orEmpty(), code)
            }
        }
        TaskSection("Admission visit not recorded", OtpAmber, d.arr("admission_visit_missing").objects()) {
            TaskRow(it.str("child_code").orEmpty(), "Admitted ${it.str("admitted_on")}", onOpenChild)
        }
        TaskSection("Open referrals", OtpRed, d.arr("referrals").objects()) {
            TaskRow(it.str("child_code").orEmpty(), "${it.str("status")?.replaceFirstChar(Char::uppercase)} to ${it.str("destination")} on ${it.str("referred_on")}", onOpenChild)
        }
        TaskSection("Needs a decision", OtpRed, d.arr("needs_decision").objects()) {
            TaskRow(it.str("child_code").orEmpty(), it.str("message").orEmpty(), onOpenChild)
        }
        TaskSection("Upcoming", OtpGreen, due.filter { it.str("state") == "upcoming" }) {
            TaskRow(it.str("child_code").orEmpty(), "Visit ${it.str("visit_number")} on ${it.str("due_on")}", onOpenChild)
        }
        TpmButton(text = "Refresh", variant = TpmButtonVariant.Ghost, fullWidth = true, onClick = { reload++ })
    }
}

@Composable
private fun TaskSection(title: String, colour: Color, items: List<JsonObject>, row: @Composable (JsonObject) -> Unit) {
    TpmCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text("${items.size}", style = MaterialTheme.typography.titleMedium, color = if (items.isEmpty()) TpmColors.TextMuted else colour)
        }
        if (items.isEmpty()) Text("None", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        items.forEach { row(it) }
    }
}

@Composable
private fun TaskRow(childCode: String, detail: String, onClick: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().clickable { onClick(childCode) }.padding(vertical = TpmSpacing.space1)) {
        Text(childCode, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
    }
}

/** The home screen's one-line summary of the visits list (counts only). */
@Composable
fun VisitsSummary(counts: JsonObject?) {
    if (counts == null) return
    val parts = listOfNotNull(
        counts.str("overdue")?.takeIf { it != "0" }?.let { "$it overdue" },
        counts.str("today")?.takeIf { it != "0" }?.let { "$it due today" },
        counts.str("awaiting_photo")?.takeIf { it != "0" }?.let { "$it photo(s) to send" },
        counts.str("referrals")?.takeIf { it != "0" }?.let { "$it open referral(s)" },
        counts.str("needs_decision")?.takeIf { it != "0" }?.let { "$it need a decision" },
        counts.str("admission_visit_missing")?.takeIf { it != "0" }?.let { "$it admission visit(s) to record" },
    )
    Text(if (parts.isEmpty()) "Nothing overdue or pending." else parts.joinToString(" · "),
        style = MaterialTheme.typography.bodyMedium, color = if (parts.isEmpty()) OtpGreen else OtpAmber)
}
