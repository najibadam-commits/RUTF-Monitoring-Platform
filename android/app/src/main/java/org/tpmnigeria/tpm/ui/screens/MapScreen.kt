package org.tpmnigeria.tpm.ui.screens

import android.Manifest
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
/** Street level, so the officer sees the Findings around where they stand. */
private const val MY_LOCATION_ZOOM = 15.0

private enum class Locate { Idle, Locating, Found, Unavailable, Denied }

/**
 * README §8 Map — one pin per issue colored by severity, overdue indicator, tap → Issue Detail.
 * Uses osmdroid/OpenStreetMap (no API key required) rather than Google Maps/Mapbox — see
 * "Map SDK / API key" in this project's README.md. Pin color mapping ported from issue-map.jsx.
 *
 * Where you are (DECISIONS R167): on opening, the map moves to the phone's current location —
 * the last known position at once, then a fresh fix — and shows a "you are here" dot; the
 * My-location button re-centres. Location permission is asked once; without it (or without a
 * fix) the map shows all the Findings as before. The location is only used on screen: it is not
 * saved or sent anywhere.
 */
@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun MapScreen(onIssueClick: (String) -> Unit) {
    val repository = LocalAppRepository.current
    val issues by repository.observeIssues().collectAsState(initial = emptyList())
    val context = LocalContext.current
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }
    var me by remember { mutableStateOf<GeoPoint?>(null) }
    var locate by remember { mutableStateOf(Locate.Idle) }
    var recentre by remember { mutableIntStateOf(0) }
    // The Findings fallback centres once, not on every data update (which would undo the user's panning).
    val centredOnFindings = remember { booleanArrayOf(false) }

    val permission = rememberMultiplePermissionsState(
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
    )
    val granted = permission.permissions.any { it.status.isGranted }

    LaunchedEffect(Unit) { if (!granted) permission.launchMultiplePermissionRequest() }

    // Find the user: the last known position straight away, then a fresh fix. Re-runs on the button.
    LaunchedEffect(granted, recentre) {
        if (!granted) {
            // No permission (refused, or the request is still on screen): show all the Findings.
            locate = Locate.Denied
            return@LaunchedEffect
        }
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

    // Move the map to the user whenever a new position arrives or the button is pressed.
    LaunchedEffect(me, recentre) {
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
                // Without the user's position, show all the Findings (once).
                val noLocation = locate == Locate.Denied || locate == Locate.Unavailable
                if (me == null && noLocation && issues.isNotEmpty() && !centredOnFindings[0]) {
                    centredOnFindings[0] = true
                    mapView.controller.animateTo(GeoPoint(issues.map { it.gpsIssue.lat }.average(), issues.map { it.gpsIssue.lng }.average()))
                }
                mapView.invalidate()
            },
        )

        // Status while locating, or why the map is not at the user's position.
        val status = when (locate) {
            Locate.Locating -> if (me == null) "Finding your location…" else null
            Locate.Denied -> "Location is off: showing all Findings. Tap the button to allow it."
            Locate.Unavailable -> "Couldn't get your location: showing all Findings."
            else -> null
        }
        if (status != null) {
            Text(
                status,
                style = MaterialTheme.typography.bodySmall,
                color = TpmColors.Text,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 12.dp, start = 16.dp, end = 16.dp)
                    .glass(RoundedCornerShape(999.dp), elevation = 4.dp)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }

        // My location: re-centre (and ask again for permission if it was refused).
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .size(52.dp)
                .shadow(8.dp, CircleShape, ambientColor = TpmColors.Blue.copy(alpha = 0.3f), spotColor = TpmColors.Blue.copy(alpha = 0.3f))
                .background(TpmColors.White, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (locate == Locate.Locating) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp, color = TpmColors.Accent)
            } else {
                IconButton(onClick = {
                    if (!granted) permission.launchMultiplePermissionRequest()
                    recentre++
                }) {
                    Icon(
                        if (locate == Locate.Denied) Icons.Filled.LocationDisabled else Icons.Filled.MyLocation,
                        contentDescription = "Go to my location",
                        tint = TpmColors.Accent700,
                    )
                }
            }
        }
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
