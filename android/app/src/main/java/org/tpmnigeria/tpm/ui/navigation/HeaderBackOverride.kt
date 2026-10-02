package org.tpmnigeria.tpm.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Lets a wizard screen intercept the shared header's back arrow to decrement its own step
 * instead of popping the nav back stack — README §5: "Back button on step 1 exits the flow"
 * (steps > 1 go back a step instead). Null override just falls through to a normal nav pop.
 */
val LocalHeaderBackOverride = staticCompositionLocalOf<MutableState<(() -> Unit)?>> {
    error("LocalHeaderBackOverride not provided — wrap the app in AppNavHost")
}

/** Call from a wizard screen: registers [onBack] as the header's back action while this
 *  Composable is in the tree, and clears it on dispose. Pass null to fall through to nav-pop
 *  (i.e. on step 1). */
@Composable
fun RegisterHeaderBack(onBack: (() -> Unit)?) {
    val state = LocalHeaderBackOverride.current
    DisposableEffect(onBack) {
        state.value = onBack
        onDispose { state.value = null }
    }
}
