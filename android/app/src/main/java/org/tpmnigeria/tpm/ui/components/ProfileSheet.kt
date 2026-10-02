package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/**
 * Opens from the header avatar. Role now comes from the signed-in Supabase account (no more
 * demo role switcher — see AppSession/DECISIONS.md #7 in the web project). The connectivity
 * override is a debug-build-only affordance for testing the offline queue (gated by
 * [showConnectivityOverride], which callers should pass `BuildConfig.DEBUG`) — README §11's
 * "drop the toggles in production" applies to it in release builds automatically.
 *
 * "Clear device access" (vs. plain "Log out") is the production-stabilization audit's Section 6
 * fix: logout alone deliberately keeps this account usable offline on this device (see
 * AppSession.logout's kdoc) — this is the action that actually removes it, for handing the device
 * to someone else. [pendingSyncCount] gates the confirmation copy so nobody wipes local
 * credentials out from under field data that hasn't synced yet without being told.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(
    userName: String,
    userInitials: String,
    userSubtitle: String,
    isDemoOffline: Boolean,
    onSetDemoOffline: (Boolean) -> Unit,
    onLogout: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    showConnectivityOverride: Boolean = false,
    pendingSyncCount: Int = 0,
    onClearDeviceAccess: (() -> Unit)? = null,
) {
    var confirmingClear by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = TpmColors.Background,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = TpmSpacing.space4, vertical = TpmSpacing.space2)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(44.dp).background(TpmColors.Accent800, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(userInitials, color = TpmColors.Background, style = MaterialTheme.typography.titleMedium)
                }
                Spacer(Modifier.size(TpmSpacing.space3))
                Column {
                    Text(userName, style = MaterialTheme.typography.titleMedium)
                    Text(userSubtitle, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                }
            }

            if (showConnectivityOverride) {
                Spacer(Modifier.height(TpmSpacing.space4))
                Text("Connectivity (debug)", style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
                Spacer(Modifier.height(TpmSpacing.space1))
                TpmSegmentedControl(
                    options = listOf(false, true),
                    selected = isDemoOffline,
                    onSelect = onSetDemoOffline,
                    labelFor = { if (it) "Offline" else "Online" },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(TpmSpacing.space4))
            TpmButton(
                text = "Log out",
                onClick = onLogout,
                variant = TpmButtonVariant.Secondary,
                blueprint = true,
                fullWidth = true,
            )

            if (onClearDeviceAccess != null) {
                Spacer(Modifier.height(TpmSpacing.space2))
                TpmButton(
                    text = "Clear device access",
                    onClick = { confirmingClear = true },
                    variant = TpmButtonVariant.Ghost,
                    fullWidth = true,
                )
            }
            Spacer(Modifier.height(TpmSpacing.space4))
        }
    }

    if (confirmingClear && onClearDeviceAccess != null) {
        AlertDialog(
            onDismissRequest = { confirmingClear = false },
            title = { Text("Clear device access?") },
            text = {
                Text(
                    if (pendingSyncCount > 0) {
                        "This removes $userName's saved sign-in from this device. This device has " +
                            "$pendingSyncCount unsynced record${if (pendingSyncCount == 1) "" else "s"} — " +
                            "connect to the internet and sync before clearing, or that field data will " +
                            "be unreachable until $userName signs in online again."
                    } else {
                        "This removes $userName's saved sign-in from this device. Nobody will be able " +
                            "to open the app on this device without signing in online again."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmingClear = false; onClearDeviceAccess() }) {
                    Text("Clear access", color = TpmColors.Accent800)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingClear = false }) { Text("Cancel") }
            },
        )
    }
}
