package org.tpmnigeria.tpm.ui.screens

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.drawable.toDrawable
import org.tpmnigeria.tpm.domain.computeSla
import org.tpmnigeria.tpm.domain.severityMapColorHex
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker

private val NIGERIA_CENTER = GeoPoint(9.082, 8.6753)

/**
 * README §8 Map — one pin per issue colored by severity, overdue indicator, tap → Issue Detail.
 * Uses osmdroid/OpenStreetMap (no API key required) rather than Google Maps/Mapbox — see
 * "Map SDK / API key" in this project's README.md for swapping to a keyed SDK later if the team
 * wants one. Pin color mapping ported from issue-map.jsx's severityColor().
 */
@Composable
fun MapScreen(onIssueClick: (String) -> Unit) {
    val repository = LocalAppRepository.current
    val issues by repository.observeIssues().collectAsState(initial = emptyList())
    val context = LocalContext.current
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }

    // osmdroid's MapView holds native tile-provider threads/caches that aren't released just by
    // leaving the Composition — onDetach() must be called explicitly or they leak/keep running.
    DisposableEffect(Unit) {
        onDispose { mapViewRef?.onDetach() }
    }

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
            if (issues.isNotEmpty()) {
                val avgLat = issues.map { it.gpsIssue.lat }.average()
                val avgLng = issues.map { it.gpsIssue.lng }.average()
                mapView.controller.animateTo(GeoPoint(avgLat, avgLng))
            }
            mapView.invalidate()
        },
    )
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
