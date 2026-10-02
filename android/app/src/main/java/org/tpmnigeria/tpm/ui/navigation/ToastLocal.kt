package org.tpmnigeria.tpm.ui.navigation

import androidx.compose.runtime.staticCompositionLocalOf
import org.tpmnigeria.tpm.ui.components.TpmToastState

/** Lets any screen (esp. wizard "Review & Submit" steps) fire the shared bottom toast after a
 *  successful submission — README "Shared modals: Toast ... used for all submission confirmations". */
val LocalToast = staticCompositionLocalOf<TpmToastState> {
    error("LocalToast not provided — wrap the app in AppNavHost")
}
