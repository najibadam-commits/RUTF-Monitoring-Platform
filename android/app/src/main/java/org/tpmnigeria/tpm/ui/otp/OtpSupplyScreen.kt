package org.tpmnigeria.tpm.ui.otp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.data.arr
import org.tpmnigeria.tpm.data.obj
import org.tpmnigeria.tpm.data.objects
import org.tpmnigeria.tpm.data.str
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.LocalToast
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.stock.NumberField
import org.tpmnigeria.tpm.ui.stock.ReviewRow
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import java.util.UUID

private val STATUS = mapOf(
    "submitted" to "Waiting for the LGA Nutrition Officer", "under_review" to "Under review", "queried" to "Queried: please answer",
    "approved" to "Approved: waiting for dispatch", "partially_fulfilled" to "Partly sent", "dispatched" to "Dispatched: record the receipt",
    "received" to "Received", "rejected" to "Rejected", "cancelled" to "Cancelled",
)

/**
 * The OTP Officer asks the LGA store for RUTF (RUTF DECISIONS R170). The site, its LGA store, the
 * balance on hand and the last 30 days' use come from the server; the officer gives the quantity
 * (cartons), days out of stock and why. The LGA Nutrition Officer approves (possibly less, with
 * the reason), queries or rejects; a query is answered here. Approval moves no stock: the RUTF
 * arrives as an ordinary transfer, received through Receive Stock, which closes the request.
 */
@Composable
fun OtpSupplyScreen(onExit: () -> Unit) {
    val repo = remember { OtpRepository() }
    val toast = LocalToast.current
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)

    var form by remember { mutableStateOf<JsonObject?>(null) }
    var requests by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var cartons by remember { mutableStateOf("") }
    var stockoutDays by remember { mutableStateOf("") }
    var why by remember { mutableStateOf("") }
    var localId by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var busy by remember { mutableStateOf(false) }
    val answers = remember { mutableStateMapOf<String, String>() }
    val queries = remember { mutableStateMapOf<String, String>() }

    LaunchedEffect(reload) {
        error = null
        when (val f = repo.supplyForm()) { is OtpResult.Ok -> form = f.data; is OtpResult.Error -> error = f.message }
        when (val l = repo.supplyList()) {
            is OtpResult.Ok -> {
                requests = l.data.arr("items").objects()
                // The question on each queried request (from its history).
                requests.filter { it.str("status") == "queried" }.forEach { r ->
                    val id = r.str("id") ?: return@forEach
                    (repo.supplyGet(id) as? OtpResult.Ok)?.data?.arr("events")?.objects()
                        ?.lastOrNull { it.str("action") == "queried" }?.str("note")?.let { queries[id] = it }
                }
            }
            is OtpResult.Error -> error = error ?: l.message
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
    ) {
        Text("Request RUTF", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        error?.let { Text(it, color = OtpRed, style = MaterialTheme.typography.bodyMedium) }
        val f = form
        if (f != null) {
            val product = f.arr("products").objects().firstOrNull()
            val perCarton = product?.str("units_per_carton")?.toIntOrNull() ?: 150
            val sachets = (cartons.toIntOrNull() ?: 0) * perCarton
            TpmCard(blueprint = true) {
                Text("New request to ${f.obj("supplier")?.str("name").orEmpty()}", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space4)) {
                    ReviewRow("In stock now", "${f.str("balance_on_hand")} sachets")
                    ReviewRow("Used, last 30 days", "${f.str("consumed_30d")} sachets")
                }
                NumberField(label = "Cartons needed ($perCarton sachets a carton)", value = cartons, onValueChange = { cartons = it })
                if (sachets > 0) Text("$sachets sachets", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                NumberField(label = "Days out of stock in the last 30 (if any)", value = stockoutDays, onValueChange = { stockoutDays = it })
                TpmTextField(label = "Why this quantity", value = why, onValueChange = { why = it }, singleLine = false, minLines = 2,
                    placeholder = "Children on treatment, new admissions, stock-outs…")
                TpmButton(text = if (busy) "Sending…" else "Send to the LGA Nutrition Officer", fullWidth = true,
                    enabled = !busy && sachets > 0 && product != null, onClick = {
                        busy = true; error = null
                        scope.launch {
                            val body = buildJsonObject {
                                put("local_id", "APP-SR-$localId")
                                put("justification", why.trim())
                                put("lines", buildJsonArray {
                                    add(buildJsonObject {
                                        put("product_id", product?.str("id").orEmpty())
                                        put("requested_qty", sachets)
                                        stockoutDays.toIntOrNull()?.let { put("stockout_days", it) }
                                    })
                                })
                            }
                            when (val res = repo.supplyCreate(body)) {
                                is OtpResult.Ok -> {
                                    toast.show("Request ${res.data.str("code")} sent")
                                    cartons = ""; stockoutDays = ""; why = ""; localId = UUID.randomUUID().toString(); reload++
                                }
                                is OtpResult.Error -> error = res.message
                            }
                            busy = false
                        }
                    })
                Text("Approving moves no stock: the RUTF comes as a transfer from the LGA store. Record it with Receive Stock when it arrives.",
                    style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            }
        } else if (error == null) Text("Loading…", color = TpmColors.TextMuted)

        Text("My requests", style = MaterialTheme.typography.titleMedium)
        if (requests.isEmpty() && form != null) Text("No requests yet.", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        requests.forEach { r ->
            val id = r.str("id").orEmpty()
            val status = r.str("status").orEmpty()
            TpmCard {
                Text(r.str("code").orEmpty(), style = MaterialTheme.typography.titleSmall)
                Text(STATUS[status] ?: status, style = MaterialTheme.typography.bodyMedium,
                    color = when (status) { "received", "dispatched", "approved" -> OtpGreen; "rejected" -> OtpRed; "queried", "partially_fulfilled" -> OtpAmber; else -> TpmColors.Text })
                Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space4)) {
                    ReviewRow("Asked", "${r.str("requested_qty") ?: "—"}")
                    ReviewRow("Approved", r.str("approved_qty") ?: "—")
                    ReviewRow("Sent", r.str("dispatched_qty")?.takeIf { it != "0" } ?: "—")
                }
                if (status == "queried") {
                    queries[id]?.let { Text("Question: “$it”", style = MaterialTheme.typography.bodyMedium) }
                    TpmTextField(label = "Your answer", value = answers[id].orEmpty(), onValueChange = { answers[id] = it }, singleLine = false, minLines = 2)
                    TpmButton(text = "Send the answer", fullWidth = true, enabled = !busy && !answers[id].isNullOrBlank(), onClick = {
                        busy = true; error = null
                        scope.launch {
                            when (val res = repo.supplyAct(id, "respond", answers[id]?.trim())) {
                                is OtpResult.Ok -> { toast.show("Answer sent"); answers.remove(id); reload++ }
                                is OtpResult.Error -> error = res.message
                            }
                            busy = false
                        }
                    })
                }
                if (status in setOf("submitted", "under_review", "queried")) {
                    TpmButton(text = "Cancel this request", variant = TpmButtonVariant.Ghost, enabled = !busy, onClick = {
                        busy = true; error = null
                        scope.launch {
                            when (val res = repo.supplyAct(id, "cancel", null)) {
                                is OtpResult.Ok -> { toast.show("Request cancelled"); reload++ }
                                is OtpResult.Error -> error = res.message
                            }
                            busy = false
                        }
                    })
                }
            }
        }
    }
}
