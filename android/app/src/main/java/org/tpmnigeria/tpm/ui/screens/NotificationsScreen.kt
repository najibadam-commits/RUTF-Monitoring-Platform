package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.domain.relativeTimeString
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/** README §9 Notifications: flat list, bell icon, bold title, muted body/time, unread accent dot.
 *  Tap navigates to the related issue and marks it read. Empty state: "No notifications yet." */
@Composable
fun NotificationsScreen(onNotificationClick: (issueId: String) -> Unit) {
    val repository = LocalAppRepository.current
    val session = LocalAppSession.current
    val user = session.currentUser.collectAsState().value ?: return
    val notifications by repository.observeNotifications(user.role).collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()

    if (notifications.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No notifications yet.", color = TpmColors.TextMuted, style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(notifications, key = { it.id }) { notification ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        scope.launch { repository.markNotificationRead(notification.id) }
                        onNotificationClick(notification.issueId)
                    }
                    .padding(horizontal = TpmSpacing.space4, vertical = TpmSpacing.space3),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(TpmSpacing.space2),
            ) {
                Icon(Icons.Filled.Notifications, contentDescription = null, tint = TpmColors.TextMuted, modifier = Modifier.size(18.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(notification.title, style = MaterialTheme.typography.bodyLarge)
                    Text(notification.body, style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
                    Text(
                        relativeTimeString(notification.timestampMillis),
                        style = MaterialTheme.typography.bodySmall,
                        color = TpmColors.TextMuted,
                    )
                }
                if (notification.unread) {
                    Box(
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(TpmColors.Accent),
                    )
                }
            }
        }
    }
}
