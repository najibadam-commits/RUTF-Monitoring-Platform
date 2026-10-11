package org.tpmnigeria.tpm.ui.screens

import android.Manifest
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.osmdroid.util.BoundingBox
import androidx.compose.material.icons.filled.ZoomOutMap
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationDisabled
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.drawable.toDrawable
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.severityMapColorHex
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.components.glass
import org.tpmnigeria.tpm.ui.theme.TpmColors

private val NIGERIA_CENTER = GeoPoint(9.082, 8.6753)
/** Street level, for the My-location button. */
private const val MY_LOCATION_ZOOM = 15.0

private enum class Locate { Idle, Locating, Found, Unavailable, Denied }
private enum class MapFilter(val label: String) { Open("Open"), Closed("Closed"), All("All") }

/**
 * README §8 Map — one pin per Finding coloured by severity, overdue indicator, tap → Finding
 * detail. Uses osmdroid/OpenStreetMap (no API key required) rather than Google Maps/Mapbox — see
 * "Map SDK / API key" in this project's README.md.
 *
 * Like the web's Situation Map (DECISIONS R174): on opening, the map is framed on every Finding
 * the user may see (the same Findings as the web, R169 scoping) together with the user's own
 * position, so nothing is off screen; Open / Closed / All filters with the count, and a legend.
 * My location zooms to street level (R167); Show all frames every Finding again. The location is
 * only used on screen: it is not saved or sent anywhere.
 */
@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun MapScreen(onIssueClick: (String) -> Unit) {
    val repository = LocalAppRepository.current
    val allIssues by repository.observeIssues().collectAsState(initial = emptyList())
    val context = LocalContext.current
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }
    var me by remember { mutableStateOf<GeoPoint?>(null) }
    var locate by remember { mutableStateOf(Locate.Idle) }
    var goToMe by remember { mutableIntStateOf(0) }
    var showAll by remember { mutableIntStateOf(0) }
    var filter by remember { mutableStateOf(MapFilter.Open) }
    // The first framing happens once, not on every data update (which would undo the user's panning).
    val framed = remember { booleanArrayOf(false) }

    val issues = remember(allIssues, filter) {
        allIssues.filter {
            it.gpsIssue.lat != 0.0 && when (filter) {
                MapFilter.Open -> it.status != IssueStatus.VerifiedClosed
                MapFilter.Closed -> it.status == IssueStatus.VerifiedClosed
                MapFilter.All -> true
            }
        }
    }

    val permission = rememberMultiplePermissionsState(
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
    )
    val granted = permission.permissions.any { it.status.isGranted }

    LaunchedEffect(Unit) { if (!granted) permission.launchMultiplePermissionRequest() }

    // Find the user: the last known position straight away, then a fresh fix. Re-runs on the button.
    LaunchedEffect(granted, goToMe) {
        if (!granted) { locate = Locate.Denied; return@LaunchedEffect }
        locate = Locate.Locating
        try {
            lastKnown(context)?.let { if (me == null) me = it }
            fresh(context)?.let { me = it }
            locate = if (me != null) Locate.Found else Locate.Unavailable
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            locate = if (me != null) Locate.Found else Locate.Unavailable
        }
    }

    // Frame every Finding and the user: once when both are known, and on Show all / a filter change.
    fun frame(map: MapView, animate: Boolean) {
        val points = issues.map { GeoPoint(it.gpsIssue.lat, it.gpsIssue.lng) } + listOfNotNull(me)
        when {
            points.isEmpty() -> return
            points.size == 1 -> map.controller.animateTo(points[0], 12.0, 600L)
            else -> map.post { map.zoomToBoundingBox(BoundingBox.fromGeoPointsSafe(points).increaseByScale(1.25f), animate) }
        }
    }
    val settled = locate == Locate.Found || locate == Locate.Denied || locate == Locate.Unavailable
    LaunchedEffect(allIssues.isNotEmpty(), settled, mapViewRef) {
        val map = mapViewRef ?: return@LaunchedEffect
        if (!framed[0] && allIssues.isNotEmpty() && settled) { framed[0] = true; frame(map, true) }
    }
    LaunchedEffect(showAll, filter) { if (framed[0]) mapViewRef?.let { frame(it, true) } }
    // My location: street level at the user.
    LaunchedEffect(goToMe) {
        if (goToMe == 0) return@LaunchedEffect
        val point = me ?: return@LaunchedEffect
        mapViewRef?.controller?.animateTo(point, MY_LOCATION_ZOOM, 900L)
    }

    // osmdroid's MapView holds native tile-provider threads/caches that aren't released just by
    // leaving the Composition — onDetach() must be called explicitly or they leak/keep running.
    DisposableEffect(Unit) {
        onDispose { mapViewRef?.onDetach() }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                MapView(ctx).apply {
                    setTileSource(TileSourceFactory.MAPNIK)
                    setMultiTouchControls(true)
                    controller.setZoom(6.0)
                    controller.setCenter(NIGERIA_CENTER)
                    mapViewRef = this
                }
            },
            update = { mapView ->
                mapView.overlays.clear()
                issues.forEach { issue ->
                    val overdue = computeSla(issue).overdue
                    val marker = Marker(mapView).apply {
                        position = GeoPoint(issue.gpsIssue.lat, issue.gpsIssue.lng)
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                        icon = circleMarkerDrawable(context.resources, severityMapColorHex(issue.severity), overdue)
                        title = "${issue.id} · ${issue.category}"
                        setOnMarkerClickListener { _, _ -> onIssueClick(issue.id); true }
                    }
                    mapView.overlays.add(marker)
                }
                me?.let { point ->
                    mapView.overlays.add(Marker(mapView).apply {
                        position = point
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                        icon = myLocationDrawable(context.resources)
                        title = "You are here"
                        setOnMarkerClickListener { m, _ -> m.showInfoWindow(); true }
                    })
                }
                mapView.invalidate()
            },
        )

        // Filters and the count, as on the web.
        Column(
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 10.dp, start = 12.dp, end = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.glass(RoundedCornerShape(999.dp), elevation = 4.dp).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                MapFilter.entries.forEach { f ->
                    val count = when (f) {
                        MapFilter.Open -> allIssues.count { it.status != IssueStatus.VerifiedClosed }
                        MapFilter.Closed -> allIssues.count { it.status == IssueStatus.VerifiedClosed }
                        MapFilter.All -> allIssues.size
                    }
                    val on = f == filter
                    Text(
                        "${f.label} $count",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (on) TpmColors.White else TpmColors.Accent800,
                        modifier = Modifier
                            .background(if (on) TpmColors.Accent700 else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(999.dp))
                            .clickable(onClickLabel = "Show ${f.label.lowercase()} Findings") { filter = f }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
            val status = when (locate) {
                Locate.Locating -> if (me == null) "Finding your location…" else null
                Locate.Denied -> "Location is off: tap the button to allow it."
                Locate.Unavailable -> "Couldn't get your location."
                else -> null
            }
            if (status != null) {
                Text(status, style = MaterialTheme.typography.bodySmall, color = TpmColors.Text,
                    modifier = Modifier.glass(RoundedCornerShape(999.dp), elevation = 4.dp).padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }

        // Legend: severity colours, the overdue ring, you are here.
        Column(
            modifier = Modifier.align(Alignment.BottomStart).padding(12.dp)
                .glass(RoundedCornerShape(14.dp), elevation = 4.dp).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            listOf(Severity.High to "High", Severity.Medium to "Medium", Severity.Low to "Low").forEach { (s, label) ->
                LegendRow(androidx.compose.ui.graphics.Color(AndroidColor.parseColor(severityMapColorHex(s))), label)
            }
            Text("Thick ring: overdue", style = MaterialTheme.typography.labelSmall, color = TpmColors.TextMuted)
            if (me != null) LegendRow(TpmColors.Blue, "You are here")
        }

        // Show all, and My location (asks again for permission if it was refused).
        Column(
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MapButton(onClick = { showAll++ }) {
                Icon(Icons.Filled.ZoomOutMap, contentDescription = "Show all Findings", tint = TpmColors.Accent700)
            }
            MapButton(onClick = { if (!granted) permission.launchMultiplePermissionRequest(); goToMe++ }) {
                if (locate == Locate.Locating) CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp, color = TpmColors.Accent)
                else Icon(if (locate == Locate.Denied) Icons.Filled.LocationDisabled else Icons.Filled.MyLocation,
                    contentDescription = "Go to my location", tint = TpmColors.Accent700)
            }
        }
    }
}

@Composable
private fun LegendRow(colour: androidx.compose.ui.graphics.Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(10.dp).background(colour, CircleShape))
        Text(label, style = MaterialTheme.typography.labelSmall, color = TpmColors.Text)
    }
}

@Composable
private fun MapButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(52.dp)
            .shadow(8.dp, CircleShape, ambientColor = TpmColors.Blue.copy(alpha = 0.3f), spotColor = TpmColors.Blue.copy(alpha = 0.3f))
            .background(TpmColors.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        IconButton(onClick = onClick) { content() }
    }
}

/** The phone's last known position (instant, may be a little old), or null. */
@SuppressLint("MissingPermission") // only called once location permission is granted
private suspend fun lastKnown(context: Context): GeoPoint? =
    LocationServices.getFusedLocationProviderClient(context).lastLocation.await()?.let { GeoPoint(it.latitude, it.longitude) }

/** A fresh fix (up to 12 seconds), or null. */
@SuppressLint("MissingPermission") // only called once location permission is granted
private suspend fun fresh(context: Context): GeoPoint? {
    val request = CurrentLocationRequest.Builder()
        .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
        .setDurationMillis(12_000)
        .build()
    return LocationServices.getFusedLocationProviderClient(context).getCurrentLocation(request, null).await()
        ?.let { GeoPoint(it.latitude, it.longitude) }
}

/** The "you are here" dot: brand blue with a white ring and a soft halo. */
private fun myLocationDrawable(resources: Resources): android.graphics.drawable.Drawable {
    val d = resources.displayMetrics.density
    val size = (34 * d).toInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val c = size / 2f
    canvas.drawCircle(c, c, c, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.argb(60, 0x16, 0x87, 0xF8) })
    canvas.drawCircle(c, c, 9 * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.WHITE })
    canvas.drawCircle(c, c, 6.5f * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.parseColor("#1687F8") })
    return bitmap.toDrawable(resources)
}

/** Draws a filled circle bitmap (osmdroid has no built-in circleMarker like Leaflet's) — plain
 *  colored dot, thicker white ring when overdue, matching issue-map.jsx's marker styling. */
private fun circleMarkerDrawable(resources: Resources, colorHex: String, overdue: Boolean): android.graphics.drawable.Drawable {
    val diameterPx = ((if (overdue) 22 else 18) * resources.displayMetrics.density).toInt()
    val bitmap = Bitmap.createBitmap(diameterPx, diameterPx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val color = AndroidColor.parseColor(colorHex)
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.FILL; alpha = (0.85f * 255).toInt() }
    val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = AndroidColor.WHITE
        style = Paint.Style.STROKE
        strokeWidth = if (overdue) 6f else 3f
    }
    val cx = bitmap.width / 2f
    val cy = bitmap.height / 2f
    val radius = bitmap.width / 2f - strokePaint.strokeWidth
    canvas.drawCircle(cx, cy, radius, fillPaint)
    canvas.drawCircle(cx, cy, radius, strokePaint)
    return bitmap.toDrawable(resources)
}
