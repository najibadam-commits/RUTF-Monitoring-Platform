package org.tpmnigeria.tpm.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius

/** Auto-dismiss (2.6s, matching the prototype's showToast) message-holder for [TpmToast]. */
class TpmToastState(private val scope: CoroutineScope) {
    var message by mutableStateOf<String?>(null)
        private set
    private var dismissJob: Job? = null

    fun show(text: String) {
        message = text
        dismissJob?.cancel()
        dismissJob = scope.launch {
            delay(2600)
            message = null
        }
    }
}

@Composable
fun rememberTpmToastState(): TpmToastState {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    return remember { TpmToastState(scope) }
}

/**
 * Bottom-anchored confirmation toast — checkmark + message, used for all submission confirmations
 * (README "Shared modals"). Auto-dismiss is driven by the caller (see rememberTpmToastState).
 */
@Composable
fun TpmToast(message: String?, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = message != null,
        enter = fadeIn() + slideInVertically(initialOffsetY = { it / 2 }),
        exit = fadeOut() + slideOutVertically(targetOffsetY = { it / 2 }),
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier
                .background(TpmColors.Accent900, RoundedCornerShape(TpmRadius.small))
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = TpmColors.Background, modifier = Modifier.width(14.dp))
            Spacer(Modifier.width(8.dp))
            Text(message.orEmpty(), color = TpmColors.Background, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
