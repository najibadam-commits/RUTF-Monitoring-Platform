package org.tpmnigeria.tpm.ui.screens

import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.components.TpmSectionHeader
import org.tpmnigeria.tpm.ui.components.TpmMetricCard
import org.tpmnigeria.tpm.ui.components.TpmGradientBackground
import org.tpmnigeria.tpm.ui.components.TpmFeatureTile
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.Today
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Store
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.MoveToInbox
import androidx.compose.material.icons.filled.MedicalServices
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.LocalHospital
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.automirrored.filled.FactCheck
import androidx.compose.material.icons.filled.EventBusy
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ChildCare
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Calculate
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Apps
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.delay
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import org.tpmnigeria.tpm.domain.MobileAccess
import org.tpmnigeria.tpm.domain.FINDING_TARGET_DAYS
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.UserRole
import org.tpmnigeria.tpm.domain.model.locationLabel
import org.tpmnigeria.tpm.domain.statusMeta
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.navigation.Routes
import org.tpmnigeria.tpm.ui.components.IssueRow
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

private data class Kpi(val label: String, val count: Int, val filter: String?, val toSyncQueue: Boolean = false)

/** README §2 Home. KPI grid + role CTA + Recent Issues, matching the prototype's per-role KPI
 *  set (search `const kpis` in TPM Field App.dc.html). Filter values passed to
 *  onNavigateToIssueList are IssueStatus enum names, or the special values "all"/"overdue" —
 *  see IssueListScreen's filter parsing. */
@Composable
fun HomeScreen(
    onNavigateToIssueList: (filter: String?) -> Unit,
    onIssueClick: (String) -> Unit,
    onStartNewIssue: () -> Unit,
    onStartDriLookup: () -> Unit,
    onStartStock: (route: String) -> Unit,
    onNavigateToSyncQueue: () -> Unit,
    onLogout: () -> Unit,
) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val user = session.currentUser.collectAsState().value ?: return
    val issues by repository.observeIssues().collectAsState(initial = emptyList())
    val pendingSync by repository.observePendingSyncCount().collectAsState(initial = 0)

    val role = user.role
    val kpis = remember(issues, pendingSync, role) { buildKpis(issues, pendingSync, role) }
    val recent = issues.take(3)

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(TpmSpacing.space4),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
    ) {
        item {
            // The welcome panel (glass design, R164): gradient, soft shapes, white text.
            TpmGradientBackground(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(TpmRadius.large)),
            ) {
                Column(modifier = Modifier.fillMaxWidth().padding(TpmSpacing.space4), verticalArrangement = Arrangement.spacedBy(TpmSpacing.space1)) {
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Good day,", style = MaterialTheme.typography.bodyMedium, color = TpmColors.White.copy(alpha = 0.9f))
                            Text(user.name, style = MaterialTheme.typography.headlineSmall, color = TpmColors.White)
                        }
                        androidx.compose.material3.TextButton(onClick = onLogout) {
                            Text("Sign out", style = MaterialTheme.typography.labelLarge, color = TpmColors.White)
                        }
                    }
                    SyncStatusLine(pendingSync, onNavigateToSyncQueue)
                }
            }
            Spacer(Modifier.height(TpmSpacing.space3))
            if (MobileAccess.canSupervise(role) && user.supervisionLevel != null) {
                SupervisionActions(user.supervisionLevel, onStartStock)
            }
            if (role == UserRole.Dri) {
                MyFacilityCard(user.facilityId)
                Spacer(Modifier.height(TpmSpacing.space2))
                if (MobileAccess.canRecordStock(role) && user.facilityId != null) {
                    StockActions(user.facilityId, onStartStock)
                }
            }
            // Each action shows only for a role the server would actually let perform it — see
            // MobileAccess. A role with none of these (State Coordinator) gets a pure oversight Home.
            var anyAction = false
            if (MobileAccess.canRegisterFinding(role)) {
                anyAction = true
                TpmButton(
                    text = "Register New Finding",
                    icon = Icons.Filled.Add,
                    onClick = onStartNewIssue,
                    blueprint = true,
                    fullWidth = true,
                )
                Spacer(Modifier.height(TpmSpacing.space2))
            }
            if (MobileAccess.canRespondToFinding(role)) {
                anyAction = true
                TpmButton(
                    text = "Look Up Finding ID",
                    icon = Icons.Filled.Search,
                    onClick = onStartDriLookup,
                    blueprint = true,
                    fullWidth = true,
                )
            }
            if (anyAction) Spacer(Modifier.height(TpmSpacing.space2))
            Spacer(Modifier.height(TpmSpacing.space2))
        }

        item { TpmSectionHeader("Findings") }
        items(kpis.chunked(2)) { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space3), modifier = Modifier.fillMaxWidth()) {
                pair.forEach { kpi ->
                    val (icon, tint, bg) = kpiStyle(kpi)
                    TpmMetricCard(
                        label = kpi.label,
                        value = kpi.count.toString(),
                        icon = icon,
                        accent = tint,
                        accentBg = bg,
                        modifier = Modifier.weight(1f),
                        onClick = { if (kpi.toSyncQueue) onNavigateToSyncQueue() else onNavigateToIssueList(kpi.filter) },
                    )
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }

        item {
            Spacer(Modifier.height(TpmSpacing.space2))
            TpmSectionHeader("Recent Findings")
        }

        if (recent.isEmpty()) {
            item {
                Text(
                    "No findings yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.TextMuted,
                    modifier = Modifier.padding(vertical = TpmSpacing.space4),
                )
            }
        } else {
            items(recent) { issue ->
                val sla = computeSla(issue)
                val meta = statusMeta(issue.status)
                IssueRow(
                    issueId = issue.id,
                    line2 = "${issue.locationLabel} · ${issue.dateReported}",
                    statusLabel = meta.label,
                    statusVariant = meta.variant,
                    overdue = sla.overdue,
                    onClick = { onIssueClick(issue.id) },
                )
            }
        }
    }
}

private fun buildKpis(issues: List<Issue>, pendingSync: Int, role: UserRole): List<Kpi> {
    fun count(predicate: (Issue) -> Boolean) = issues.count(predicate)
    val overdueCount = issues.count { computeSla(it).overdue }
    if (MobileAccess.isOversightRole(role)) {
        // Whole-picture counts across everything this account can see (RLS-scoped: all Findings
        // for Super Admin, own project for Project Admin, own state for State Coordinator).
        // Pending Sync only appears for a role that can queue writes at all.
        val canQueueWrites = MobileAccess.canRegisterFinding(role) || MobileAccess.canVerifyResolution(role)
        return listOfNotNull(
            Kpi("All Findings", issues.size, "all"),
            Kpi("Awaiting review", count { it.status == IssueStatus.PendingReview }, IssueStatus.PendingReview.name),
            Kpi("With the facility", count { it.status == IssueStatus.Ongoing }, IssueStatus.Ongoing.name),
            Kpi("Action recorded, to verify", count { it.status == IssueStatus.ResolvedPendingVerification }, IssueStatus.ResolvedPendingVerification.name),
            Kpi("Verified & closed", count { it.status == IssueStatus.VerifiedClosed }, IssueStatus.VerifiedClosed.name),
            Kpi("Reopened", count { it.status == IssueStatus.Reopened }, IssueStatus.Reopened.name),
            Kpi("Past the ${FINDING_TARGET_DAYS}-day target", overdueCount, "overdue"),
            if (canQueueWrites) Kpi("Waiting to sync", pendingSync, null, toSyncQueue = true) else null,
        )
    }
    return if (role == UserRole.FieldMonitor) {
        listOf(
            Kpi("Findings raised", issues.size, "all"),
            Kpi("With the facility", count { it.status == IssueStatus.Ongoing }, IssueStatus.Ongoing.name),
            Kpi("Action recorded, to verify", count { it.status == IssueStatus.ResolvedPendingVerification }, IssueStatus.ResolvedPendingVerification.name),
            Kpi("Verified & closed", count { it.status == IssueStatus.VerifiedClosed }, IssueStatus.VerifiedClosed.name),
            Kpi("Reopened", count { it.status == IssueStatus.Reopened }, IssueStatus.Reopened.name),
            Kpi("Past the ${FINDING_TARGET_DAYS}-day target", overdueCount, "overdue"),
            Kpi("Waiting to sync", pendingSync, null, toSyncQueue = true),
        )
    } else {
        listOf(
            Kpi("Open Findings", count { it.status != IssueStatus.VerifiedClosed }, "all"),
            Kpi("New to respond to", count { it.status == IssueStatus.New }, IssueStatus.New.name),
            Kpi("Being addressed", count { it.status == IssueStatus.Ongoing }, IssueStatus.Ongoing.name),
            Kpi("Action recorded", count { it.status == IssueStatus.ResolvedPendingVerification }, IssueStatus.ResolvedPendingVerification.name),
            Kpi("Returned for more action", count { it.status == IssueStatus.Reopened }, IssueStatus.Reopened.name),
            Kpi("Past the ${FINDING_TARGET_DAYS}-day target", overdueCount, "overdue"),
            Kpi("Waiting to sync", pendingSync, null, toSyncQueue = true),
        )
    }
}

/** Offline status at a glance: everything synced, or how many entries are still on the phone. */
@Composable
private fun SyncStatusLine(pendingSync: Int, onOpen: () -> Unit) {
    Text(
        if (pendingSync == 0) "✓ Everything is synced"
        else "$pendingSync ${if (pendingSync == 1) "entry is" else "entries are"} on this phone, waiting to sync. They send by themselves when you're online.",
        style = MaterialTheme.typography.bodySmall,
        color = TpmColors.White,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = "Open the sync queue", onClick = onOpen)
            .padding(top = TpmSpacing.space1),
    )
}

private val FACILITY_TYPE_LABEL = mapOf(
    "state_store" to "State store",
    "lga_store" to "LGA store",
    "health_facility" to "Health facility",
)

/**
 * The one facility a facility user records for (web migration 0100), read from the offline
 * cache. What the cache holds is already server-scoped to this facility, its supplier and the
 * facilities it supplies (ReferenceRepository.refreshFacilities), so this works offline too.
 */
@Composable
private fun MyFacilityCard(facilityId: String?) {
    val references = LocalReferenceRepository.current
    TpmCard(modifier = Modifier.fillMaxWidth()) {
        Text("My facility", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        if (facilityId == null) {
            Text("No facility assigned — ask your administrator to assign one.", style = MaterialTheme.typography.bodyMedium)
            return@TpmCard
        }
        val facility by remember(facilityId) { references.observeFacility(facilityId) }.collectAsState(initial = null)
        val current = facility
        if (current == null) {
            Text("Facility details download the next time you are online.", style = MaterialTheme.typography.bodyMedium)
            return@TpmCard
        }
        val supplier by remember(current.suppliedById) {
            current.suppliedById?.let { references.observeFacility(it) } ?: kotlinx.coroutines.flow.flowOf(null)
        }.collectAsState(initial = null)
        val supplied by remember(current.id) { references.observeFacilitiesSuppliedBy(current.id) }.collectAsState(initial = emptyList())

        Text(current.name, style = MaterialTheme.typography.titleMedium)
        val type = FACILITY_TYPE_LABEL[current.facilityType] ?: current.facilityType
        Text(if (current.isOtpSite) "$type · OTP site" else type, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        // Stock on hand from the offline ledger cache plus entries still waiting to sync (R101).
        val stock = LocalStockRepository.current
        val position by remember(current.id) { stock.observeStock(current.id) }.collectAsState(initial = null)
        position?.let { p ->
            Spacer(Modifier.height(TpmSpacing.space2))
            Text(
                "On hand: ${"%,d".format(p.total)} sachets",
                style = MaterialTheme.typography.titleSmall,
                color = if (p.total <= 0) TpmColors.Error else MaterialTheme.colorScheme.onSurface,
            )
        }
        supplier?.let { Text("Supplied by ${it.name}", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted) }
        if (supplied.isNotEmpty()) {
            Text("Supplies ${supplied.size} facilit${if (supplied.size == 1) "y" else "ies"}", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }
    }
}

/**
 * The facility user's recording actions (brief §8), by facility: Issue Stock for stores only,
 * Daily Dispensing for OTP sites only. Each works offline through the sync queue.
 */
@Composable
private fun StockActions(facilityId: String, onStart: (String) -> Unit) {
    val references = LocalReferenceRepository.current
    val facility by remember(facilityId) { references.observeFacility(facilityId) }.collectAsState(initial = null)
    // The officer's facility decides which actions show (OTP Admission Card, Daily Dispensing). If it
    // is not on the phone yet (a fresh install, or the first download failed), fetch it now rather
    // than waiting for the next sign-in; offline this just fails quietly and the cache stays as it was.
    LaunchedEffect(facilityId) {
        delay(1500)
        if (references.observeFacility(facilityId).first() == null) runCatching { references.refreshFacilities() }
    }
    val isStore = facility?.facilityType == "state_store" || facility?.facilityType == "lga_store"
    val isOtp = facility?.isOtpSite == true
    val actions = buildList {
        add("My Stock" to Routes.MyStock)
        add("Receive Stock" to Routes.ReceiveStock)
        if (isStore) add("Issue Stock" to Routes.IssueStock)
        if (isOtp) add("Daily Dispensing" to Routes.DailyDispensing)
        // The Digital OTP Admission Card (RUTF DECISIONS R145): the OTP Officer at an OTP site.
        if (isOtp && facility?.facilityType == "health_facility") add(0, "OTP Admission Card" to Routes.OtpHome)
        add("Stock Count" to Routes.StockCount)
        add("Record Loss / Adjustment" to Routes.LossAdjustment)
    }
    if (isOtp && facility?.facilityType == "health_facility") {
        OtpTaskSummary(onOpen = { onStart(Routes.OtpTasks) })
        Spacer(Modifier.height(TpmSpacing.space2))
    }
    TpmSectionHeader("My work")
    Spacer(Modifier.height(TpmSpacing.space2))
    ActionGrid(actions, onStart)
}

/** Actions as a two-column grid of tiles; the first (the role's main workflow) is highlighted. */
@Composable
private fun ActionGrid(actions: List<Pair<String, String>>, onStart: (String) -> Unit) {
    actions.chunked(2).forEachIndexed { row, pair ->
        Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space3), modifier = Modifier.fillMaxWidth()) {
            pair.forEachIndexed { col, (label, route) ->
                TpmFeatureTile(
                    label = label,
                    icon = actionIcon(route),
                    onClick = { onStart(route) },
                    highlighted = row == 0 && col == 0,
                    modifier = Modifier.weight(1f),
                )
            }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
        }
        Spacer(Modifier.height(TpmSpacing.space3))
    }
}

private fun actionIcon(route: String): ImageVector = when (route) {
    Routes.OtpHome -> Icons.Filled.ChildCare
    Routes.MyStock -> Icons.Filled.Inventory
    Routes.ReceiveStock -> Icons.Filled.MoveToInbox
    Routes.IssueStock -> Icons.Filled.LocalShipping
    Routes.DailyDispensing -> Icons.Filled.MedicalServices
    Routes.StockCount -> Icons.Filled.Calculate
    Routes.LossAdjustment -> Icons.Filled.RemoveCircleOutline
    Routes.StoreCheck -> Icons.Filled.Store
    Routes.OtpVerification -> Icons.Filled.VerifiedUser
    Routes.ConfirmAdjustments -> Icons.Filled.TaskAlt
    else -> Icons.Filled.Apps
}

/** Icon and colours for a Findings count, so the cards read at a glance (status is also in words). */
private fun kpiStyle(kpi: Kpi): Triple<ImageVector, Color, Color> = when {
    kpi.toSyncQueue -> Triple(Icons.Filled.CloudUpload, TpmColors.Accent700, TpmColors.Accent100)
    kpi.filter == "overdue" -> Triple(Icons.Filled.Schedule, TpmColors.Error, TpmColors.ErrorBg)
    kpi.filter == IssueStatus.Reopened.name -> Triple(Icons.Filled.Replay, TpmColors.Error, TpmColors.ErrorBg)
    kpi.filter == IssueStatus.VerifiedClosed.name -> Triple(Icons.Filled.CheckCircle, TpmColors.Success, TpmColors.SuccessBg)
    kpi.filter == IssueStatus.ResolvedPendingVerification.name -> Triple(Icons.AutoMirrored.Filled.FactCheck, TpmColors.Success, TpmColors.SuccessBg)
    kpi.filter == IssueStatus.Ongoing.name -> Triple(Icons.Filled.Build, TpmColors.Warning, TpmColors.WarningBg)
    kpi.filter == IssueStatus.PendingReview.name || kpi.filter == IssueStatus.New.name -> Triple(Icons.Filled.HourglassTop, TpmColors.Warning, TpmColors.WarningBg)
    else -> Triple(Icons.Filled.Flag, TpmColors.Accent700, TpmColors.Accent100)
}

/**
 * The OTP Officer's live task counts (from otp_my_visits: counts only, no child details), each
 * opening Visits and tasks. Online only, like the rest of the OTP Admission Card: nothing shows
 * offline rather than stale numbers.
 */
@Composable
private fun OtpTaskSummary(onOpen: () -> Unit) {
    val repo = remember { org.tpmnigeria.tpm.data.OtpRepository() }
    var counts by remember { mutableStateOf<kotlinx.serialization.json.JsonObject?>(null) }
    LaunchedEffect(Unit) {
        counts = (repo.myVisits() as? org.tpmnigeria.tpm.data.OtpResult.Ok)?.data?.let { it["counts"] as? kotlinx.serialization.json.JsonObject }
    }
    val c = counts ?: return
    fun n(k: String) = (c[k] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "0"
    TpmSectionHeader("OTP visits and tasks")
    Spacer(Modifier.height(TpmSpacing.space2))
    val cards = listOf(
        Triple("Visits overdue", n("overdue"), Icons.Filled.EventBusy),
        Triple("Visits due today", n("today"), Icons.Filled.Today),
        Triple("RUTF photos to send", n("awaiting_photo"), Icons.Filled.PhotoCamera),
        Triple("Open referrals", n("referrals"), Icons.Filled.LocalHospital),
    )
    cards.chunked(2).forEach { pair ->
        Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space3), modifier = Modifier.fillMaxWidth()) {
            pair.forEach { (label, value, icon) ->
                val urgent = value != "0" && (label.startsWith("Visits overdue") || label.startsWith("Open referrals"))
                TpmMetricCard(label = label, value = value, icon = icon, onClick = onOpen, modifier = Modifier.weight(1f),
                    accent = if (urgent) TpmColors.Error else TpmColors.Accent700, accentBg = if (urgent) TpmColors.ErrorBg else TpmColors.Accent100)
            }
        }
        Spacer(Modifier.height(TpmSpacing.space3))
    }
}

/** A supervisor's visit actions (brief §8), by level: Store Check for the stores they cover, OTP
 *  Verification for OTP sites; both confirm adjustments. */
@Composable
private fun SupervisionActions(level: String, onStart: (String) -> Unit) {
    val actions = buildList {
        if (level == "stores") add("Store Check" to Routes.StoreCheck)
        if (level == "otp_sites") add("OTP Verification" to Routes.OtpVerification)
        add("Confirm Adjustments" to Routes.ConfirmAdjustments)
    }
    TpmSectionHeader("Supervision")
    Spacer(Modifier.height(TpmSpacing.space2))
    ActionGrid(actions, onStart)
}
