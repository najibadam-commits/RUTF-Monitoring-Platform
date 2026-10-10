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
 * The weekly OTP site report (RUTF DECISIONS R147–R149). The figures are calculated live on the
 * server from the site's records — the officer reviews them, explains every flagged issue, confirms
 * and submits to the State Coordinator; nothing is typed in. A returned report shows the
 * coordinator's note; an approved one can only change by an amendment, with a reason.
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
                    "submitted" -> "Submitted: waiting for the State Coordinator"; "approved" -> "Approved"
                    "returned" -> "Returned for revision"; else -> if (r.bool("amendment")) "Amendment draft" else "Draft: not submitted"
                },
                style = MaterialTheme.typography.titleMedium,
                color = when (status) { "approved" -> OtpGreen; "returned" -> OtpRed; "submitted" -> OtpAmber; else -> TpmColors.Text },
            )
            ReviewRow("Due", r.str("due").orEmpty())
            r.obj("last_decision")?.let { d ->
                ReviewRow(if (d.str("decision") == "approved") "Approved by" else "Returned by", "${d.str("by")}")
                d.str("note")?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium) }
            }
            Text("Calculated live from this site's records: nothing to type in. Review, explain anything flagged, then submit.",
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
                ReviewRow("D. Transfers", "in ${d?.obj("in")?.str("total")}, out ${d?.obj("out")?.str("total")}")
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
            if (r.bool("amendment")) TpmTextField(label = "Reason for amending the approved report", value = amendmentReason, onValueChange = { amendmentReason = it })
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
        } else if (status == "approved") {
            TpmButton(text = "Amend this approved report", variant = TpmButtonVariant.Ghost, fullWidth = true, onClick = {
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
