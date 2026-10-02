package org.tpmnigeria.tpm.ui

import androidx.compose.runtime.staticCompositionLocalOf
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.data.ReferenceRepository
import org.tpmnigeria.tpm.data.StockRepository
import org.tpmnigeria.tpm.session.AppSession

/**
 * Small app-wide dependencies made available to any Composable without prop-drilling through
 * NavGraph — provided once at the root in MainActivity. Screens that only *read* state (most of
 * them) collect straight from [AppRepository]'s Flows; only the multi-step wizards need real
 * ViewModels to hold in-progress form state.
 */
val LocalAppRepository = staticCompositionLocalOf<AppRepository> {
    error("LocalAppRepository not provided — wrap the app in AppProviders")
}

val LocalAppSession = staticCompositionLocalOf<AppSession> {
    error("LocalAppSession not provided — wrap the app in AppProviders")
}

val LocalStockRepository = staticCompositionLocalOf<StockRepository> {
    error("LocalStockRepository not provided — wrap the app in AppProviders")
}

val LocalReferenceRepository = staticCompositionLocalOf<ReferenceRepository> {
    error("LocalReferenceRepository not provided — wrap the app in AppProviders")
}
