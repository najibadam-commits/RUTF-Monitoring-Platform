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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.data.arr
import org.tpmnigeria.tpm.data.bool
import org.tpmnigeria.tpm.data.obj
import org.tpmnigeria.tpm.data.objects
import org.tpmnigeria.tpm.data.str
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
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters

/**
 * The weekly OTP site report (RUTF DECISIONS R147–R149, R153). The figures are calculated live on
 * the server from the site's records — the officer reviews them, explains every flagged issue,
 * corrects a figure only with a reason (kept with the calculated value), confirms and submits to
 * the State Coordinator. A returned report shows the coordinator's note; an approved or rejected
 * one can only change by an amendment, with a reason.
 */
@Composable
fun OtpWeeklyReportScreen(onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)

    // The last six reporting weeks (Monday to Sunday), the latest complete one first.
    val weeks = remember {
        val thisMonday = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        (1..6).map { thisMonday.minusWeeks(it.toLong()) } + thisMonday
    }
    val label = DateTimeFormatter.ofPattern("d MMM")
    var week by remember { mutableStateOf(weeks.first()) }
    var report by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val explanations = remember { mutableStateMapOf<String, String>() }
    var general by remember { mutableStateOf("") }
    var amendmentReason by remember { mutableStateOf("") }
    var confirmed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(week, reload) {
        report = null; error = null; confirmed = false
        when (val r = repo.reportOpen(week.toString())) {
            is OtpResult.Ok -> {
                report = r.data
                explanations.clear()
                r.data.obj("draft_comments")?.forEach { (k, v) ->
                    val text = (v as? JsonPrimitive)?.contentOrNull.orEmpty()
                    if (k == "general") general = text else explanations[k] = text
                }
            }
            is OtpResult.Error -> error = r.message
        }
    }
    fun comments() = buildJsonObject {
        if (general.isNotBlank()) put("general", general.trim())
        explanations.forEach { (k, v) -> if (v.isNotBlank()) put(k, v.trim()) }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
    ) {
        Text("Weekly OTP report", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        TpmDropdown(label = "Reporting week (Monday to Sunday)", selected = week, options = weeks, onSelect = { week = it },
            labelFor = { "${it.format(label)} – ${it.plusDays(6).format(label)}" + if (it == weeks.last()) " (this week)" else "" })
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
        val r = report ?: run { if (error == null) Text("Calculating the report…", color = TpmColors.TextMuted); return@Column }
        val sections = r.obj("sections")
        val status = r.str("status").orEmpty()
        val editable = r.bool("editable")

        TpmCard(blueprint = true) {
            Text(
                when (status) {
                    "submitted" -> "Submitted: waiting for the State Coordinator"; "under_review" -> "Under review by the State Coordinator"
                    "approved" -> "Approved"; "returned" -> "Returned for correction"; "rejected" -> "Rejected"
                    else -> if (r.bool("amendment")) "Amendment draft" else "Draft: not submitted"
                },
                style = MaterialTheme.typography.titleMedium,
                color = when (status) { "approved" -> OtpGreen; "returned", "rejected" -> OtpRed; "submitted", "under_review" -> OtpAmber; else -> TpmColors.Text },
            )
            ReviewRow("Due", r.str("due").orEmpty())
            r.obj("last_decision")?.let { d ->
                ReviewRow(when (d.str("decision")) { "approved" -> "Approved by"; "rejected" -> "Rejected by"; else -> "Returned by" }, "${d.str("by")}")
                d.str("note")?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium) }
            }
            Text("Calculated live from this site's records. Review it, explain anything flagged, correct a figure only with a reason, then submit.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }

        // The figures (a compact review of each section; the full report opens on the web).
        sections?.let { s ->
            val bSam = s.obj("B")?.obj("SAM"); val c = s.obj("C")?.obj("SAM"); val d = s.obj("D")?.obj("SAM")
            val e = s.obj("E")?.obj("SAM"); val f = s.obj("F")?.obj("SAM"); val g = s.obj("G"); val h = s.obj("H")
            val i = s.obj("I"); val j = s.obj("J")
            TpmCard {
                Text("Caseload (SAM)", style = MaterialTheme.typography.titleMedium)
                ReviewRow("B. At the start", "${bSam?.str("total")} (boys ${bSam?.str("M")}, girls ${bSam?.str("F")})")
                ReviewRow("C. New cases", "${c?.str("total")} · 6–23 m: ${c?.str("M_6_23")} boys, ${c?.str("F_6_23")} girls · 24–59 m: ${c?.str("M_24_59")} boys, ${c?.str("F_24_59")} girls")
                c?.obj("categories")?.let { k ->
                    ReviewRow("C. By category", "new ${k.obj("new_case")?.str("total")}, relapse ${k.obj("relapse")?.str("total")}, readmission ${k.obj("readmission")?.str("total")}, " +
                        "returned defaulters ${k.obj("returned_defaulter")?.str("total")}, from stabilisation ${k.obj("from_stabilisation")?.str("total")}, others ${k.obj("others")?.str("total")}")
                }
                ReviewRow("D. Transfers", "in ${d?.obj("in")?.str("total")}, out ${d?.obj("out")?.str("total")}")
                e?.obj("referred")?.let { rf ->
                    ReviewRow("E. Referred this week", "to stabilisation ${rf.obj("to_stabilisation")?.str("total")}, elsewhere ${rf.obj("others")?.str("total")} (still under treatment)")
                }
                ReviewRow("E. Outcomes", "cured ${e?.obj("cured")?.str("total")}, non-recovered ${e?.obj("non_recovered")?.str("total")}, died ${e?.obj("died")?.str("total")}, defaulted ${e?.obj("defaulted")?.str("total")}, absent ${e?.obj("absent")?.str("total")}")
                val calc = f?.obj("calculated")?.str("total"); val actual = f?.obj("actual")?.str("total")
                ReviewRow("F. At the end", "$actual" + if (calc == actual) " ✓ reconciled" else " ✗ calculated $calc")
                Text("HR MAM: not applicable (no admission rule in the guidelines).", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
            TpmCard {
                Text("Stock and activities", style = MaterialTheme.typography.titleMedium)
                ReviewRow("G. RUTF", "opening ${g?.str("opening")}, received ${g?.str("received")}, dispensed " +
                    (if (g?.str("dispensed_status") == "missing") "missing" else "${g?.str("dispensed")}") +
                    ", expected ${g?.str("expected_closing")} sachets · count ${g?.str("physical_count") ?: "pending"}")
                ReviewRow("H. MNP", if (h?.str("status") == "not_recorded") "not recorded" else
                    "expected ${h?.str("expected_closing")} sachets · doses 1st ${h?.obj("doses")?.str("dose_1")}, 2nd ${h?.obj("doses")?.str("dose_2")}, 3rd ${h?.obj("doses")?.str("dose_3")}")
                ReviewRow("I. MUAC screened", "${i?.obj("total")?.str("total")} (red ${i?.obj("red")?.str("total")}, yellow ${i?.obj("yellow")?.str("total")}, green ${i?.obj("green")?.str("total")})")
                ReviewRow("J. IYCF / health education", if (j?.str("status") == "none_recorded") "no sessions recorded" else
                    "${j?.str("sessions")} sessions, ${j?.str("total_participants") ?: "—"} participants")
            }
            s.obj("L")?.let { l ->
                val v = l.obj("visits"); val rutf = l.obj("rutf"); val rec = l.obj("recovery"); val ref = l.obj("referrals"); val ap = l.obj("appointments")
                TpmCard {
                    Text("L. Visits and follow-up", style = MaterialTheme.typography.titleMedium)
                    ReviewRow("Visits", "admission ${v?.str("admission")}, 2nd ${v?.str("second")}, 3rd ${v?.str("third")}, 4th or later ${v?.str("fourth_or_later")} · absent ${v?.str("absent")}")
                    ReviewRow("RUTF at visits", "${rutf?.str("given")} packets given / ${rutf?.str("recommended")} recommended · ${rutf?.str("visits_differing")} visit(s) differed · none recommended at ${rutf?.str("visits_withheld")}")
                    ReviewRow("Since the previous visit", "improved ${rec?.str("improved")}, no change ${rec?.str("unchanged")}, worse ${rec?.str("deteriorated")}")
                    ReviewRow("Referrals", "made ${ref?.str("made")} · open at the end of the week ${ref?.str("open_at_week_end")}")
                    ReviewRow("Scheduled visits", "due ${ap?.str("due_in_week")}, attended ${ap?.str("attended")}, missed ${ap?.str("missed")} · overdue at the end of the week ${ap?.str("overdue_at_week_end")}")
                    ReviewRow("Incomplete records", "RUTF photos to send ${l.str("awaiting_photo")} · admission visits not recorded ${l.str("admission_visit_missing")}")
                }
            }
            CorrectionsCard(r, s, editable, onChanged = { reload++ })
        }

        // K. Issues and explanations.
        val issues = r.arr("issues").objects()
        TpmCard {
            Text("Checks", style = MaterialTheme.typography.titleMedium)
            if (issues.isEmpty()) Text("No issues flagged.", color = OtpGreen, style = MaterialTheme.typography.bodyMedium)
            issues.forEach { iss ->
                val code = iss.str("code").orEmpty()
                val sev = iss.str("severity")
                Text((if (sev == "blocking") "Must be explained · " else if (sev == "warning") "Warning · " else "Note · ") + iss.str("message").orEmpty(),
                    color = if (sev == "blocking") OtpRed else if (sev == "warning") OtpAmber else TpmColors.TextMuted, style = MaterialTheme.typography.bodyMedium)
                if (editable && sev != "info") TpmTextField(label = "Explanation", value = explanations[code].orEmpty(), onValueChange = { explanations[code] = it })
            }
            if (editable) TpmTextField(label = "General comment (optional)", value = general, onValueChange = { general = it }, singleLine = false, minLines = 2)
        }

        if (editable) {
            if (r.bool("amendment")) TpmTextField(label = "Reason for the amendment", value = amendmentReason, onValueChange = { amendmentReason = it })
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = confirmed, onCheckedChange = { confirmed = it })
                Text("I have reviewed this report against the site's records")
            }
            val missing = issues.count { it.str("severity") == "blocking" && explanations[it.str("code")].isNullOrBlank() }
            if (missing > 0) Text("$missing flagged issue(s) still need an explanation.", color = OtpRed, style = MaterialTheme.typography.bodySmall)
            val weekOver = !week.plusDays(6).isAfter(LocalDate.now().minusDays(1))
            if (!weekOver) Text("The week isn't over yet: you can save explanations now and submit from ${week.plusDays(7).format(label)}.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
                TpmButton(text = "Save draft", variant = TpmButtonVariant.Secondary, enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        when (val res = repo.reportSaveComments(r.str("report_id").orEmpty(), comments())) {
                            is OtpResult.Ok -> toast.show("Draft saved")
                            is OtpResult.Error -> error = res.message
                        }
                        busy = false
                    }
                })
                TpmButton(text = if (busy) "Submitting…" else "Submit to the State Coordinator",
                    enabled = !busy && confirmed && missing == 0 && weekOver && (!r.bool("amendment") || amendmentReason.isNotBlank()),
                    onClick = {
                        busy = true; error = null
                        scope.launch {
                            when (val res = repo.reportSubmit(r.str("report_id").orEmpty(), comments(), amendmentReason)) {
                                is OtpResult.Ok -> { toast.show("Submitted: version ${res.data.str("version")}"); reload++ }
                                is OtpResult.Error -> error = res.message
                            }
                            busy = false
                        }
                    })
            }
        } else if (r.bool("can_amend") || status == "approved") {
            TpmButton(text = if (status == "rejected") "Start a new version (amendment)" else "Amend this approved report", variant = TpmButtonVariant.Ghost, fullWidth = true, onClick = {
                scope.launch {
                    when (val res = repo.reportStartAmendment(r.str("report_id").orEmpty())) {
                        is OtpResult.Ok -> reload++
                        is OtpResult.Error -> error = res.message
                    }
                }
            })
        }
        Text("Versions: ${r.arr("versions").size} · every submission and decision is kept.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
    }
}

/** The figures that may be corrected, with their place in the report. */
private val CORRECTABLE = listOf(
    "B.SAM.total" to "B. Under treatment at the start", "C.SAM.total" to "C. New cases",
    "D.SAM.in.total" to "D. Transfers in", "D.SAM.out.total" to "D. Transfers out",
    "E.SAM.cured.total" to "E. Cured", "E.SAM.defaulted.total" to "E. Defaulted", "E.SAM.died.total" to "E. Died",
    "E.SAM.non_recovered.total" to "E. Non-recovered", "E.SAM.absent.total" to "E. Absent",
    "F.SAM.actual.total" to "F. Under treatment at the end",
    "G.received" to "G. RUTF received (sachets)", "G.dispensed" to "G. RUTF dispensed (sachets)", "G.losses" to "G. RUTF losses (sachets)",
    "I.total.total" to "I. Children screened", "J.sessions" to "J. Sessions", "J.total_participants" to "J. Participants",
    "L.visits.admission" to "L. Admission visits", "L.visits.second" to "L. Second visits", "L.visits.third" to "L. Third visits",
    "L.visits.fourth_or_later" to "L. Fourth or later visits", "L.visits.absent" to "L. Absences", "L.rutf.given" to "L. RUTF packets given",
    "L.referrals.made" to "L. Referrals made",
)

private fun valueAt(sections: JsonObject, path: String): String? {
    val parts = path.split(".")
    var node: JsonObject? = sections
    parts.dropLast(1).forEach { node = node?.obj(it) }
    return node?.str(parts.last())
}

private val WHOLE_NUMBER = Regex("^-?\\d*$")

/**
 * Corrections (web 0128): a calculated figure may be corrected only with a reason. The calculated
 * value, the corrected value, who and when are kept, and the State Coordinator sees each one.
 * Fixing the source record (a visit, a stock entry) is still the first choice: the report recalculates.
 */
@Composable
private fun CorrectionsCard(report: JsonObject, sections: JsonObject, editable: Boolean, onChanged: () -> Unit) {
    val repo = remember { OtpRepository() }
    val scope = rememberCoroutineScope()
    val adjustments = report.arr("adjustments").objects()
    var path by remember { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    if (!editable && adjustments.isEmpty()) return
    val labels = CORRECTABLE.toMap()
    TpmCard {
        Text("Corrections", style = MaterialTheme.typography.titleMedium)
        if (adjustments.isEmpty()) Text("None. Correct the source record first if you can: the report recalculates.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        adjustments.forEach { a ->
            val p = a.str("path").orEmpty()
            ReviewRow(labels[p] ?: p, "calculated ${a.str("original")} → corrected ${a.str("adjusted")} · ${a.str("reason")} (${a.str("by")})")
            if (editable) TpmButton(text = "Remove", variant = TpmButtonVariant.Ghost, onClick = {
                scope.launch {
                    when (val r = repo.reportAdjust(report.str("report_id").orEmpty(), p, null, "Correction removed")) {
                        is OtpResult.Ok -> onChanged()
                        is OtpResult.Error -> error = r.message
                    }
                }
            })
        }
        if (editable) {
            TpmDropdown(label = "Figure to correct", selected = path, options = CORRECTABLE.map { it.first }, onSelect = { path = it; value = "" },
                labelFor = { "${labels[it]} (now ${valueAt(sections, it) ?: "—"})" })
            if (path != null) {
                TpmTextField(label = "Corrected value", value = value, onValueChange = { if (it.matches(WHOLE_NUMBER)) value = it }, keyboardType = KeyboardType.Number)
                TpmTextField(label = "Reason (required)", value = reason, onValueChange = { reason = it })
                TpmButton(text = "Save the correction", enabled = value.toDoubleOrNull() != null && reason.isNotBlank(), onClick = {
                    error = null
                    scope.launch {
                        when (val r = repo.reportAdjust(report.str("report_id").orEmpty(), path!!, value.toDouble(), reason.trim())) {
                            is OtpResult.Ok -> { path = null; value = ""; reason = ""; onChanged() }
                            is OtpResult.Error -> error = r.message
                        }
                    }
                })
            }
        }
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodySmall) }
    }
}
