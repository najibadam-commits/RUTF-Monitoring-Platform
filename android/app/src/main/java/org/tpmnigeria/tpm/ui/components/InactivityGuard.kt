package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.ui.components.modal.TpmDialog
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/**
 * Automatic sign-out after inactivity (DPIA risk R2, DECISIONS R168): a signed-in phone left
 * unattended must not stay open on children's records. Checks once a second how long it has been
 * since the last touch ([AppSession.idleMillis]); in the last minute before the limit it asks
 * "Still there?", and at the limit it signs out. The check keeps running while the app is in the
 * background, so a phone put away signs itself out too.
 */
@Composable
fun InactivityGuard(session: AppSession) {
    var idle by remember { mutableLongStateOf(0L) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(session) {
        while (true) {
            idle = session.idleMillis()
            if (idle >= AppSession.INACTIVITY_TIMEOUT_MILLIS) {
                session.signOutForInactivity()
                return@LaunchedEffect
            }
            delay(1_000)
        }
    }

    val left = AppSession.INACTIVITY_TIMEOUT_MILLIS - idle
    if (left <= AppSession.INACTIVITY_WARNING_MILLIS) {
        val stay = { session.noteActivity(); idle = 0L }
        TpmDialog(title = "Still there?", onDismiss = stay) {
            Column(verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3)) {
                Text(
                    "To protect children's records, the app signs out after 15 minutes without use. " +
                        "Signing out in ${(left.coerceAtLeast(0L) + 999) / 1000} seconds.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TpmColors.Text,
                )
                Text(
                    "Anything waiting to sync stays on this phone and is sent after you sign in again. " +
                        "A form you have not saved yet will be lost.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TpmColors.TextMuted,
                )
                TpmButton(text = "Stay signed in", onClick = stay, fullWidth = true)
                TpmButton(
                    text = "Sign out now",
                    onClick = { scope.launch { session.logout() } },
                    variant = TpmButtonVariant.Secondary,
                    fullWidth = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
