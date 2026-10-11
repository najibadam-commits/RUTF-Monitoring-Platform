package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmElevation
import org.tpmnigeria.tpm.ui.theme.TpmGradients
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/*
 * The glass design system's building blocks (DECISIONS R164). "Glass" here is a near-opaque white
 * surface with a light edge and a soft blue-tinted shadow over a gradient: real backdrop blur is
 * expensive on the low-end phones used in the field and unreadable in sunlight, so it is not used.
 */

/** A glass panel: near-white surface, light edge, soft shadow. Use for content over gradients. */
fun Modifier.glass(
    shape: Shape = RoundedCornerShape(TpmRadius.medium),
    elevation: Dp = TpmElevation.card,
    surface: Color = TpmColors.Surface,
): Modifier = this
    .shadow(elevation, shape, clip = false, ambientColor = TpmColors.Blue.copy(alpha = 0.18f), spotColor = TpmColors.Blue.copy(alpha = 0.22f))
    .clip(shape)
    .background(surface, shape)
    .border(BorderStroke(1.dp, TpmColors.GlassBorder), shape)

/**
 * The gradient backdrop with soft decorative shapes (blue, cyan, mint) drawn behind the content.
 * Purely decorative: the shapes take no input and sit under [content].
 */
@Composable
fun TpmGradientBackground(
    modifier: Modifier = Modifier,
    brush: Brush = TpmGradients.Hero,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier = modifier.background(brush)) {
        Canvas(modifier = Modifier.matchParentSize()) {
            val w = size.width
            val h = size.height
            drawCircle(Color.White.copy(alpha = 0.10f), radius = w * 0.55f, center = Offset(w * 1.02f, h * 0.02f))
            drawCircle(TpmColors.Mint.copy(alpha = 0.22f), radius = w * 0.38f, center = Offset(-w * 0.08f, h * 0.88f))
            drawCircle(TpmColors.Cyan.copy(alpha = 0.25f), radius = w * 0.22f, center = Offset(w * 0.86f, h * 0.70f))
            drawCircle(Color.White.copy(alpha = 0.07f), radius = w * 0.16f, center = Offset(w * 0.12f, h * 0.16f))
        }
        content()
    }
}

/** A section heading inside a screen: a short gradient tick and the title. */
@Composable
fun TpmSectionHeader(title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(modifier = modifier.fillMaxWidth().padding(top = TpmSpacing.space2), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(4.dp).size(width = 4.dp, height = 16.dp).clip(RoundedCornerShape(2.dp)).background(TpmGradients.Edge))
        Spacer(Modifier.width(TpmSpacing.space2))
        Text(title, style = MaterialTheme.typography.titleMedium, color = TpmColors.Text, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

/** A round icon badge in a soft brand tint (used by metric cards and feature tiles). */
@Composable
fun TpmIconBadge(icon: ImageVector, tint: Color = TpmColors.Accent700, background: Color = TpmColors.Accent100, size: Dp = 40.dp) {
    Box(modifier = Modifier.size(size).clip(CircleShape).background(background), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

/** A dashboard metric: icon, a prominent live value, a label; tappable when it leads somewhere. */
@Composable
fun TpmMetricCard(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    accent: Color = TpmColors.Accent700,
    accentBg: Color = TpmColors.Accent100,
    onClick: (() -> Unit)? = null,
) {
    var m = modifier.glass().heightIn(min = 96.dp)
    if (onClick != null) m = m.clickable(role = Role.Button, onClickLabel = "Open $label", onClick = onClick)
    Column(modifier = m.padding(TpmSpacing.space4), verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TpmIconBadge(icon, tint = accent, background = accentBg, size = 34.dp)
            Spacer(Modifier.weight(1f))
            Text(value, style = MaterialTheme.typography.headlineSmall, color = TpmColors.Text, fontWeight = FontWeight.SemiBold)
        }
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** A feature in the dashboard's grid: icon and label; the whole tile is the touch target. */
@Composable
fun TpmFeatureTile(
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    detail: String? = null,
) {
    val shape = RoundedCornerShape(TpmRadius.medium)
    val m = if (highlighted) modifier.shadow(TpmElevation.card, shape, ambientColor = TpmColors.Blue.copy(alpha = 0.25f), spotColor = TpmColors.Blue.copy(alpha = 0.3f))
        .clip(shape).background(TpmGradients.Primary, shape) else modifier.glass(shape)
    Column(
        modifier = m.clickable(role = Role.Button, onClick = onClick).heightIn(min = 96.dp).padding(TpmSpacing.space3),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
    ) {
        if (highlighted) TpmIconBadge(icon, tint = TpmColors.White, background = Color.White.copy(alpha = 0.22f), size = 36.dp)
        else TpmIconBadge(icon, size = 36.dp)
        Text(label, style = MaterialTheme.typography.titleSmall, color = if (highlighted) TpmColors.White else TpmColors.Text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (highlighted) Color.White.copy(alpha = 0.9f) else TpmColors.TextMuted, maxLines = 2) }
    }
}

/** Loading, empty and error states, the same everywhere. */
@Composable
fun TpmLoadingState(message: String = "Loading…", modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth().padding(TpmSpacing.space4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = TpmColors.Accent)
        Spacer(Modifier.width(TpmSpacing.space2))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
    }
}

@Composable
fun TpmEmptyState(message: String, icon: ImageVector, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(TpmSpacing.space6), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
        TpmIconBadge(icon, tint = TpmColors.Neutral600, background = TpmColors.Neutral100, size = 48.dp)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
    }
}

@Composable
fun TpmErrorState(message: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) {
    Column(modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(TpmRadius.small)).background(TpmColors.ErrorBg).padding(TpmSpacing.space3),
        verticalArrangement = Arrangement.spacedBy(TpmSpacing.space2)) {
        Text(message, style = MaterialTheme.typography.bodyMedium, color = TpmColors.Error)
        onRetry?.let { TpmButton(text = "Try again", onClick = it, variant = TpmButtonVariant.Ghost) }
    }
}

/** A full-screen backdrop for content-light screens: the page colour with a gradient band on top. */
@Composable
fun TpmPageBackdrop(bandHeight: Dp = 140.dp, content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(TpmColors.Background)) {
        TpmGradientBackground(modifier = Modifier.fillMaxWidth().heightIn(min = bandHeight, max = bandHeight)) {}
        content()
    }
}
