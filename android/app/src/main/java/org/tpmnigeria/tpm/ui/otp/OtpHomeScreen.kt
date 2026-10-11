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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import kotlinx.serialization.json.JsonObject
import org.tpmnigeria.tpm.data.OtpRepository
import org.tpmnigeria.tpm.data.OtpResult
import org.tpmnigeria.tpm.data.obj
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.navigation.RegisterHeaderBack
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/** Child ID as issued by the server, in the Beneficiary Card's format DTAP-STATE-LGA-NNNNNNN (e.g. DTAP-KTS-DAU-0000042); older IDs (KT-DAU-26-00042) still open. */
private val CHILD_ID = Regex("""^[A-Z0-9]{2,6}(-[A-Z0-9]{2,6})+-\d{4,8}$""")

/**
 * The OTP Admission Card entry point (OTP Officers at an OTP site). A returning child is opened by
 * entering the Child ID from their card; a new child starts with screening.
 */
@Composable
fun OtpHomeScreen(
    onScreenChild: () -> Unit,
    onOpenChild: (String) -> Unit,
    onWeeklyReport: () -> Unit,
    onMnp: () -> Unit,
    onIycf: () -> Unit,
    onVisits: () -> Unit,
    onSupply: () -> Unit,
    onExit: () -> Unit,
) {
    val repo = remember { OtpRepository() }
    var code by remember { mutableStateOf("") }
    var counts by remember { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(Unit) { counts = (repo.myVisits() as? OtpResult.Ok)?.data?.obj("counts") }
    val clean = code.trim().uppercase()
    val valid = CHILD_ID.matches(clean)
    BackHandler(onBack = onExit)
    RegisterHeaderBack(onExit)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space4),
    ) {
        Text("OTP Admission Card", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text(
            "Screen and admit children with severe acute malnutrition, and record each visit against their Child ID. " +
                "A child's details open only when you enter their Child ID, and are never saved on this phone.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted,
        )

        TpmCard {
            Text("Visits and tasks", style = MaterialTheme.typography.titleMedium)
            VisitsSummary(counts)
            TpmButton(text = "Open visits and tasks", onClick = onVisits, variant = TpmButtonVariant.Secondary, fullWidth = true)
        }

        TpmCard(blueprint = true) {
            Text("Find existing child", style = MaterialTheme.typography.titleMedium)
            TpmTextField(label = "Child ID (from the caregiver's card)", value = code, onValueChange = { code = it.uppercase() },
                placeholder = "e.g. DTAP-KTS-DAU-0000042")
            if (code.isNotBlank() && !valid) {
                Text("A Child ID looks like DTAP-KTS-DAU-0000042.", style = MaterialTheme.typography.bodySmall, color = OtpAmber)
            }
            TpmButton(text = "Open the child's card", onClick = { onOpenChild(clean) }, enabled = valid, fullWidth = true)
        }

        TpmCard {
            Text("Register new child", style = MaterialTheme.typography.titleMedium)
            Text("First visit: screen the child. If they meet the OTP criteria you register them, the Child ID is issued, and you record the admission visit with the RUTF given.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            TpmButton(text = "Screen a child", onClick = onScreenChild, variant = TpmButtonVariant.Secondary, fullWidth = true, blueprint = true)
        }
        TpmCard {
            Text("Weekly report and activities", style = MaterialTheme.typography.titleMedium)
            Text("The weekly report is calculated from this site's records: review it and submit it to the LGA Nutrition Officer.",
                style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            TpmButton(text = "Weekly OTP report", onClick = onWeeklyReport, fullWidth = true, blueprint = true)
            TpmButton(text = "Request RUTF from the LGA store", onClick = onSupply, variant = TpmButtonVariant.Secondary, fullWidth = true)
            TpmButton(text = "MNP stock and doses", onClick = onMnp, variant = TpmButtonVariant.Secondary, fullWidth = true)
            TpmButton(text = "IYCF / health education session", onClick = onIycf, variant = TpmButtonVariant.Secondary, fullWidth = true)
        }
        Text("Needs a connection: Child IDs are issued by the server so two phones never give the same one.",
            style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
    }
}
