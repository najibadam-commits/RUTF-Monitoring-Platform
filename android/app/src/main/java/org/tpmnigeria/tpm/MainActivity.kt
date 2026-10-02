package org.tpmnigeria.tpm

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.LocalAppSession
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.ui.navigation.AppNavHost
import org.tpmnigeria.tpm.ui.screens.LoginScreen
import org.tpmnigeria.tpm.ui.screens.SetPasswordScreen
import org.tpmnigeria.tpm.ui.theme.TpmTheme

class MainActivity : ComponentActivity() {
    /** Bumped on every onCreate/onNewIntent that carries a deep link, so TpmRoot's LaunchedEffect
     *  re-fires even if the URI string itself repeats (unlikely, but cheap to guard anyway). */
    private var pendingDeepLinkUri = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Must run before super.onCreate() per the SplashScreen API contract — Theme.TpmApp.Splash
        // (set on this activity in the manifest) is what actually paints it; this just wires up
        // the exit transition and the automatic swap back to Theme.TpmApp (postSplashScreenTheme).
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingDeepLinkUri.value = intent?.data?.toString()
        val app = application as TpmApplication
        setContent {
            CompositionLocalProvider(
                LocalAppRepository provides app.repository,
                LocalAppSession provides app.session,
                LocalReferenceRepository provides app.referenceRepository,
            ) {
                TpmTheme {
                    Surface(modifier = Modifier.fillMaxSize()) {
                        TpmRoot(app, pendingDeepLinkUri.value) { pendingDeepLinkUri.value = null }
                    }
                }
            }
        }
    }

    /** singleTask launchMode (see AndroidManifest.xml) routes a re-tapped invitation/reset link
     *  here instead of spawning a second Activity instance while the app is already running. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingDeepLinkUri.value = intent.data?.toString()
    }
}

@Composable
private fun TpmRoot(app: TpmApplication, deepLinkUri: String?, onDeepLinkConsumed: () -> Unit) {
    // supabase-kt persists the session locally and restores it into the SDK automatically; this
    // just re-fetches the profile row so the app can skip Login when there's already a valid
    // session (e.g. app reopened, not force-stopped since last sign-in).
    var restoring by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        app.session.restoreSession()
        restoring = false
    }

    // Invitation/password-reset link handling — see AppSession.handleAuthDeepLink. Runs
    // independently of the restoreSession() gate above so a cold-started deep link doesn't have
    // to wait on it, and re-fires whenever a new link comes in (onNewIntent).
    LaunchedEffect(deepLinkUri) {
        val uri = deepLinkUri ?: return@LaunchedEffect
        app.session.handleAuthDeepLink(uri)
        onDeepLinkConsumed()
    }

    val loggedIn by app.session.loggedIn.collectAsState()
    val passwordRecoveryPending by app.session.passwordRecoveryPending.collectAsState()
    when {
        // Takes priority over both Login and the normal app — the user can't do anything else
        // with a mid-recovery session until they've set a new password.
        passwordRecoveryPending -> SetPasswordScreen(session = app.session)
        restoring -> Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        loggedIn -> AppNavHost(session = app.session)
        else -> LoginScreen(session = app.session)
    }
}
