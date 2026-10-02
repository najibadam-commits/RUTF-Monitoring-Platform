package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import org.tpmnigeria.tpm.data.remote.EvidenceStorage
import org.tpmnigeria.tpm.domain.MobileAccess
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.formatCoords
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.locationLabel
import org.tpmnigeria.tpm.domain.priorityLabel
import org.tpmnigeria.tpm.domain.severityTagVariant
import org.tpmnigeria.tpm.domain.statusMeta
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.LocalStockRepository
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmCard
import org.tpmnigeria.tpm.ui.components.TpmTag
import org.tpmnigeria.tpm.ui.components.TpmTagVariant
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing
import org.tpmnigeria.tpm.sync.SupabaseSyncApiService

/** README §4 Issue Detail — header card, Evidence, Geographic Records, Case History, sticky CTA. */
@Composable
fun IssueDetailScreen(
    issueId: String,
    justRegistered: Boolean,
    onBack: () -> Unit,
    onRespond: (String) -> Unit,
    onVerify: (String) -> Unit,
    onCloseToHome: () -> Unit,
) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val stockRepository = LocalStockRepository.current
    val user = session.currentUser.collectAsState().value ?: return
    val issue by repository.observeIssue(issueId).collectAsState(initial = null)

    val apiService = remember { SupabaseSyncApiService(repository, session, stockRepository) }
    LaunchedEffect(issueId) {
        val current = repository.getIssue(issueId)
        if (current?.remoteId != null) {
            repository.refreshIssue(issueId, apiService)
        }
    }

    val current = issue
    if (current == null) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Loading…", color = TpmColors.TextMuted)
        }
        return
    }

    val driCtaVisible = MobileAccess.canRespondToFinding(user.role) &&
        current.status in setOf(IssueStatus.New, IssueStatus.Ongoing, IssueStatus.Reopened)
    val fmCtaVisible = MobileAccess.canVerifyResolution(user.role) &&
        current.status == IssueStatus.ResolvedPendingVerification
    val showHomeCta = justRegistered && !driCtaVisible && !fmCtaVisible

    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.weight(1f, fill = true).fillMaxWidth(),
            contentPadding = PaddingValues(TpmSpacing.space4),
        ) {
            item { HeaderCard(current) }
            item { Spacer(Modifier.height(TpmSpacing.space4)) }
            item { EvidenceSection(current) }
            item { Spacer(Modifier.height(TpmSpacing.space4)) }
            item { GeographicRecordsSection(current) }
            item { Spacer(Modifier.height(TpmSpacing.space4)) }
            item { CaseHistorySection(current) }
            item { Spacer(Modifier.height(TpmSpacing.space4)) }
        }

        if (driCtaVisible || fmCtaVisible || showHomeCta) {
            Column(modifier = Modifier.fillMaxWidth().padding(TpmSpacing.space4)) {
                when {
                    driCtaVisible -> TpmButton(text = "Respond to Finding", onClick = { onRespond(current.id) }, blueprint = true, fullWidth = true)
                    fmCtaVisible -> TpmButton(text = "Verify Resolution", onClick = { onVerify(current.id) }, blueprint = true, fullWidth = true)
                    showHomeCta -> TpmButton(text = "Close & Back to Home", onClick = onCloseToHome, variant = TpmButtonVariant.Secondary, blueprint = true, fullWidth = true)
                }
            }
        }
    }
}

@Composable
private fun HeaderCard(issue: Issue) {
    val sla = computeSla(issue)
    val meta = statusMeta(issue.status)
    TpmCard(blueprint = true, modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(issue.category.uppercase(), style = MaterialTheme.typography.labelSmall, color = TpmColors.Accent)
            TpmTag(meta.label, meta.variant)
        }
        Text(issue.id, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
            TpmTag(issue.severity.priorityLabel(), severityTagVariant(issue.severity))
            if (sla.hasSla) {
                TpmTag(sla.label, if (sla.overdue) TpmTagVariant.Outline else TpmTagVariant.Neutral)
            }
        }
        Text(
            "${issue.locationLabel} · ${issue.ward}, ${issue.lga}, ${issue.state}",
            style = MaterialTheme.typography.bodySmall,
            color = TpmColors.TextMuted,
        )
        Text(issue.description, style = MaterialTheme.typography.bodyMedium)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Filled.Person, contentDescription = null, tint = TpmColors.TextMuted, modifier = Modifier.size(14.dp))
            Text(
                "Reported by ${issue.reporter} · ${issue.dateReported}",
                style = MaterialTheme.typography.bodySmall,
                color = TpmColors.TextMuted,
            )
        }
    }
}

@Composable
private fun EvidenceSection(issue: Issue) {
    Column {
        EvidenceStage("Evidence — Finding Discovery", null, issue.movPhotoPath, issue.selfiePhotoPath, alwaysShow = true)
        // Later lifecycle stages only appear once they have evidence — a Finding still awaiting
        // review has nothing to show for them, and empty placeholder rows would just be noise.
        issue.driResponse?.let { r ->
            EvidenceStage(
                title = "Evidence — DRI Response",
                caption = listOf(r.name, r.date).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { null },
                movPath = r.movPhotoPath,
                selfiePath = r.selfiePhotoPath,
            )
        }
        issue.verification?.let { v ->
            EvidenceStage(
                title = "Evidence — Final Verification",
                caption = (if (v.confirmed) "Confirmed resolved" else "Not resolved") +
                    v.comment.takeIf { it.isNotBlank() }?.let { " — $it" }.orEmpty(),
                movPath = v.movPhotoPath,
                selfiePath = v.selfiePhotoPath,
            )
        }
    }
}

@Composable
private fun EvidenceStage(title: String, caption: String?, movPath: String?, selfiePath: String?, alwaysShow: Boolean = false) {
    if (!alwaysShow && movPath == null && selfiePath == null) return
    Column(modifier = Modifier.fillMaxWidth().padding(top = if (alwaysShow) 0.dp else TpmSpacing.space4)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        if (caption != null) {
            Text(caption, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        }
        Spacer(Modifier.height(TpmSpacing.space2))
        Row(horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2), modifier = Modifier.fillMaxWidth()) {
            EvidenceTile("MOV Photo", movPath, Icons.Filled.CameraAlt, Modifier.weight(1f))
            EvidenceTile("Selfie", selfiePath, Icons.Filled.Person, Modifier.weight(1f))
        }
    }
}

@Composable
private fun EvidenceTile(label: String, path: String?, placeholderIcon: ImageVector, modifier: Modifier = Modifier) {
    // A photo captured on this device is a local file; one from Supabase Storage is a stored
    // reference that needs a fresh signed URL each time it's shown (see EvidenceStorage) — null
    // while that's being fetched, or if it can't be (offline / no access), which keeps the
    // placeholder icon rather than a broken image.
    val storagePath = remember(path) { EvidenceStorage.storagePathOf(path) }
    var signedUrl by remember(storagePath) { mutableStateOf<String?>(null) }
    LaunchedEffect(storagePath) {
        signedUrl = storagePath?.let { EvidenceStorage.signedUrl(it) }
    }
    val context = LocalContext.current
    val model: Any? = remember(path, storagePath, signedUrl) {
        when {
            path == null -> null
            storagePath != null -> signedUrl?.let { url ->
                ImageRequest.Builder(context).data(url)
                    // The signed URL changes on every fetch; key the caches on the stable Storage path.
                    .memoryCacheKey(storagePath).diskCacheKey(storagePath).build()
            }
            path.startsWith("http") -> path
            else -> java.io.File(path)
        }
    }
    TpmCard(blueprint = true, modifier = modifier) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(4f / 3f)
                .clip(RoundedCornerShape(4.dp))
                .background(TpmColors.Neutral200),
            contentAlignment = Alignment.Center,
        ) {
            if (model != null) {
                AsyncImage(
                    // Coil's String overload treats its input as a URI and a bare filesystem
                    // path (no "file://" scheme) resolves ambiguously — a File (this device's own
                    // camera output, see CameraCaptureModal) is unambiguous, and a remote photo
                    // arrives here as a ready ImageRequest built around its signed URL.
                    model = model,
                    contentDescription = label,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Icon(placeholderIcon, contentDescription = null, tint = TpmColors.Neutral500)
            }
        }
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun GeographicRecordsSection(issue: Issue) {
    Column {
        Text("Geographic Records", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        Spacer(Modifier.height(TpmSpacing.space2))
        TpmCard(modifier = Modifier.fillMaxWidth()) {
            GeoRow("Finding Discovery Location", issue.gpsIssue.lat, issue.gpsIssue.lng, issue.gpsIssue.accuracyMeters)
            issue.driResponse?.let { GeoRow("DRI Action / Resolution Location", it.gps.lat, it.gps.lng, it.gps.accuracyMeters) }
            issue.verification?.let { GeoRow("Final Verification Location", it.gps.lat, it.gps.lng, it.gps.accuracyMeters) }
        }
    }
}

@Composable
private fun GeoRow(label: String, lat: Double, lng: Double, accuracyMeters: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Filled.Place, contentDescription = null, tint = TpmColors.Accent, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(6.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
            Text(formatCoords(lat, lng), style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
        }
        TpmTag("±${accuracyMeters}m", TpmTagVariant.Neutral)
    }
}

@Composable
private fun CaseHistorySection(issue: Issue) {
    Column {
        Text("Case History", style = MaterialTheme.typography.titleSmall, color = TpmColors.TextMuted)
        Spacer(Modifier.height(TpmSpacing.space2))
        issue.history.forEachIndexed { index, event ->
            Row(modifier = Modifier.fillMaxWidth()) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(end = TpmSpacing.space2)) {
                    Box(modifier = Modifier.size(8.dp).background(TpmColors.Accent, CircleShape))
                    if (index < issue.history.lastIndex) {
                        Box(modifier = Modifier.width(1.dp).height(40.dp).background(TpmColors.Divider))
                    }
                }
                Column(modifier = Modifier.padding(bottom = TpmSpacing.space3)) {
                    Text(event.event, style = MaterialTheme.typography.bodyLarge)
                    Text("${event.user} · ${event.date} ${event.time}", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                    Text(event.location, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                }
            }
        }
    }
}
