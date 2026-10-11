package org.tpmnigeria.tpm.ui.navigation

import androidx.compose.foundation.background
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmGradients
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.BuildConfig
import org.tpmnigeria.tpm.domain.MobileAccess
import org.tpmnigeria.tpm.domain.model.UserRole
import org.tpmnigeria.tpm.domain.model.officerTitle
import org.tpmnigeria.tpm.ui.LocalReferenceRepository
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.sync.SyncScheduler
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.components.BottomNavEntry
import org.tpmnigeria.tpm.ui.components.InactivityGuard
import org.tpmnigeria.tpm.ui.components.ProfileSheet
import org.tpmnigeria.tpm.ui.components.SyncBanner
import org.tpmnigeria.tpm.ui.components.TpmBottomNav
import org.tpmnigeria.tpm.ui.components.TpmHeader
import org.tpmnigeria.tpm.ui.components.TpmToast
import org.tpmnigeria.tpm.ui.components.rememberTpmToastState
import org.tpmnigeria.tpm.ui.screens.HomeScreen
import org.tpmnigeria.tpm.ui.screens.IssueDetailScreen
import org.tpmnigeria.tpm.ui.screens.IssueListScreen
import org.tpmnigeria.tpm.ui.screens.MapScreen
import org.tpmnigeria.tpm.ui.screens.NotificationsScreen
import org.tpmnigeria.tpm.ui.screens.SyncQueueScreen
import org.tpmnigeria.tpm.ui.stock.DailyDispensingScreen
import org.tpmnigeria.tpm.ui.otp.OtpChildScreen
import org.tpmnigeria.tpm.ui.otp.OtpHomeScreen
import org.tpmnigeria.tpm.ui.otp.OtpScreeningScreen
import org.tpmnigeria.tpm.ui.otp.OtpVisitScreen
import org.tpmnigeria.tpm.ui.otp.OtpIycfScreen
import org.tpmnigeria.tpm.ui.otp.OtpMnpScreen
import org.tpmnigeria.tpm.ui.otp.OtpWeeklyReportScreen
import org.tpmnigeria.tpm.ui.otp.OtpPhotoScreen
import org.tpmnigeria.tpm.ui.otp.OtpVisitsListScreen
import org.tpmnigeria.tpm.ui.stock.IssueStockScreen
import org.tpmnigeria.tpm.ui.stock.LossAdjustmentScreen
import org.tpmnigeria.tpm.ui.stock.MyStockScreen
import org.tpmnigeria.tpm.ui.stock.ReceiveStockScreen
import org.tpmnigeria.tpm.ui.stock.StockCountScreen
import org.tpmnigeria.tpm.ui.stock.SupervisionVisitScreen
import org.tpmnigeria.tpm.ui.stock.ConfirmAdjustmentsScreen
import org.tpmnigeria.tpm.domain.LedgerKind
import org.tpmnigeria.tpm.ui.wizard.driresponse.DriRespondWizardScreen
import org.tpmnigeria.tpm.ui.wizard.newissue.NewIssueWizardScreen
import org.tpmnigeria.tpm.ui.wizard.verification.FinalVerifyWizardScreen

/**
 * Nav Compose's `destination.route` is always the *pattern* a composable() was registered with
 * (e.g. "issueList?filter={filter}"), never the concrete URI passed to navigate() — so it can't
 * be compared for equality against the bare "issueList" constant. This collapses the current
 * route down to its top-level key (or null if it's a pushed/detail screen), used for both
 * back-arrow visibility and bottom-nav tab highlighting.
 */
private fun topLevelKeyOf(route: String?): String? = when {
    route == null -> null
    route == Routes.Home -> Routes.Home
    route.startsWith("issueList") -> Routes.IssueList
    route == Routes.Map -> Routes.Map
    route == Routes.SyncQueue -> Routes.SyncQueue
    route == Routes.Notifications -> Routes.Notifications
    else -> null
}

/** Everything shown once logged in: header, bottom nav, sync banner, toast, profile sheet, and
 *  the Navigation Compose graph for all 8 non-login screens + 3 wizards. */
@Composable
fun AppNavHost(session: AppSession) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val context = androidx.compose.ui.platform.LocalContext.current

    val repository = LocalAppRepository.current
    // AppNavHost only ever composes once session.loggedIn is true, which AppSession only sets
    // after currentUser is already populated (see AppSession.loadProfile) — this guard is just
    // the type-system's nullability catching up with that invariant, not a real "logged out
    // while viewing the app" case.
    val currentUser = session.currentUser.collectAsState().value ?: return
    // The officer's title follows their facility: OTP / LGA Nutrition / State Nutrition Officer (R141).
    val references = LocalReferenceRepository.current
    val ownFacility by remember(currentUser.facilityId) {
        currentUser.facilityId?.let { references.observeFacility(it) } ?: kotlinx.coroutines.flow.flowOf(null)
    }.collectAsState(initial = null)
    val roleLabel = if (currentUser.role == UserRole.Dri) officerTitle(ownFacility?.facilityType) else currentUser.role.label
    val pendingSyncCount by repository.observePendingSyncCount().collectAsState(initial = 0)
    val unreadNotifications by repository.observeNotifications(currentUser.role)
        .map { list -> list.any { it.unread } }
        .collectAsState(initial = false)
    val demoOffline by session.demoOfflineOverride.collectAsState()
    val isOffline = session.isEffectivelyOffline()

    val headerBackOverride = remember { mutableStateOf<(() -> Unit)?>(null) }
    var profileSheetOpen by remember { mutableStateOf(false) }
    val toastState = rememberTpmToastState()

    val userInitials = remember(currentUser.name) { currentUser.name.split(" ").mapNotNull { it.firstOrNull() }.joinToString("") }

    val topLevelKey = topLevelKeyOf(currentRoute)
    val isTopLevel = topLevelKey != null
    val headerTitle = headerTitleFor(currentRoute, currentUser.role, backStackEntry?.arguments?.getString("issueId"))

    CompositionLocalProvider(
        LocalHeaderBackOverride provides headerBackOverride,
        LocalToast provides toastState,
    ) {
      Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = TpmColors.Background,
            topBar = {
                // The gradient runs under the status bar; the header's content is white (R164).
                Column(modifier = Modifier.background(TpmGradients.Primary).statusBarsPadding()) {
                    TpmHeader(
                        title = headerTitle,
                        showBack = !isTopLevel,
                        onBack = { headerBackOverride.value?.invoke() ?: navController.popBackStack() },
                        userInitials = userInitials,
                        onAvatarClick = { profileSheetOpen = true },
                        rolePill = if (currentRoute == Routes.Home) roleLabel else null,
                    )
                    if (pendingSyncCount > 0 || isOffline) {
                        SyncBanner(
                            pendingCount = pendingSyncCount,
                            isOffline = isOffline,
                            onClick = { navController.navigateTopLevel(Routes.SyncQueue) },
                        )
                    }
                }
            },
            bottomBar = {
                if (isTopLevel) {
                    TpmBottomNav(
                        items = bottomNavItems(currentUser.role, pendingSyncCount, unreadNotifications),
                        currentRoute = topLevelKey,
                        onSelect = { route ->
                            if (route == Routes.Home) {
                                // Direct navigate to Home clearing stack
                                navController.navigate(Routes.Home) {
                                    popUpTo(navController.graph.startDestinationId) { inclusive = false }
                                    launchSingleTop = true
                                }
                            } else {
                                navController.navigateTopLevel(route)
                            }
                        },
                    )
                }
            },
        ) { innerPadding ->
            Column(modifier = Modifier.padding(innerPadding)) {
                NavHost(navController = navController, startDestination = Routes.Home) {
                    composable(Routes.Home) {
                        val scope = rememberCoroutineScope()
                        HomeScreen(
                            onNavigateToIssueList = { filter -> navController.navigate(Routes.issueList(filter)) },
                            onIssueClick = { id -> navController.navigate(Routes.issueDetail(id)) },
                            onStartNewIssue = { navController.navigate(Routes.NewIssueWizard) },
                            onStartDriLookup = { navController.navigate(Routes.driRespondWizard()) },
                            onStartStock = { route -> navController.navigate(route) },
                            onNavigateToSyncQueue = { navController.navigate(Routes.SyncQueue) },
                            onLogout = { scope.launch { session.logout() } }
                        )
                    }
                    composable(
                        Routes.IssueListPattern,
                        arguments = listOf(navArgument("filter") { type = NavType.StringType; nullable = true; defaultValue = null }),
                    ) { entry ->
                        IssueListScreen(
                            initialFilter = entry.arguments?.getString("filter"),
                            onIssueClick = { id -> navController.navigate(Routes.issueDetail(id)) },
                        )
                    }
                    composable(Routes.Map) {
                        MapScreen(onIssueClick = { id -> navController.navigate(Routes.issueDetail(id)) })
                    }
                    composable(Routes.Notifications) {
                        NotificationsScreen(onNotificationClick = { id -> navController.navigate(Routes.issueDetail(id)) })
                    }
                    composable(Routes.SyncQueue) { SyncQueueScreen() }

                    composable(
                        Routes.IssueDetailPattern,
                        arguments = listOf(
                            navArgument("issueId") { type = NavType.StringType },
                            navArgument("justRegistered") { type = NavType.BoolType; defaultValue = false },
                        ),
                    ) { entry ->
                        val issueId = entry.arguments?.getString("issueId").orEmpty()
                        IssueDetailScreen(
                            issueId = issueId,
                            justRegistered = entry.arguments?.getBoolean("justRegistered") ?: false,
                            onBack = { navController.popBackStack() },
                            onRespond = { id -> navController.navigate(Routes.driRespondWizard(id)) },
                            onVerify = { id -> navController.navigate(Routes.finalVerifyWizard(id)) },
                            onCloseToHome = {
                                navController.popBackStack(Routes.Home, inclusive = false)
                            },
                        )
                    }

                    composable(Routes.NewIssueWizard) {
                        RequireAccess(MobileAccess.canRegisterFinding(currentUser.role), { navController.popBackStack() }) {
                            NewIssueWizardScreen(
                                onDone = { id ->
                                    SyncScheduler.syncNow(context)
                                    navController.navigate(Routes.issueDetail(id, justRegistered = true)) {
                                        popUpTo(Routes.NewIssueWizard) { inclusive = true }
                                    }
                                },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    composable(
                        Routes.DriRespondWizardPattern,
                        arguments = listOf(navArgument("issueId") { type = NavType.StringType; nullable = true; defaultValue = null }),
                    ) { entry ->
                        RequireAccess(MobileAccess.canRespondToFinding(currentUser.role), { navController.popBackStack() }) {
                            DriRespondWizardScreen(
                                initialIssueId = entry.arguments?.getString("issueId"),
                                onDone = { id ->
                                    SyncScheduler.syncNow(context)
                                    navController.navigate(Routes.issueDetail(id)) {
                                        popUpTo(Routes.DriRespondWizardPattern) { inclusive = true }
                                    }
                                },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    composable(
                        Routes.FinalVerifyWizardPattern,
                        arguments = listOf(navArgument("issueId") { type = NavType.StringType; nullable = true; defaultValue = null }),
                    ) { entry ->
                        RequireAccess(MobileAccess.canVerifyResolution(currentUser.role), { navController.popBackStack() }) {
                            FinalVerifyWizardScreen(
                                initialIssueId = entry.arguments?.getString("issueId"),
                                onDone = { id ->
                                    SyncScheduler.syncNow(context)
                                    navController.navigate(Routes.issueDetail(id)) {
                                        popUpTo(Routes.FinalVerifyWizardPattern) { inclusive = true }
                                    }
                                },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    // Facility stock — every screen needs the user's facility (DECISIONS R15).
                    val facilityId = currentUser.facilityId
                    val stockAllowed = MobileAccess.canRecordStock(currentUser.role) && facilityId != null
                    val backHome: () -> Unit = {
                        SyncScheduler.syncNow(context)
                        navController.popBackStack(Routes.Home, inclusive = false)
                    }
                    composable(Routes.MyStock) {
                        RequireAccess(stockAllowed, { navController.popBackStack() }) { MyStockScreen(facilityId!!) }
                    }
                    composable(Routes.ReceiveStock) {
                        RequireAccess(stockAllowed, { navController.popBackStack() }) {
                            ReceiveStockScreen(facilityId!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.IssueStock) {
                        RequireAccess(stockAllowed, { navController.popBackStack() }) {
                            IssueStockScreen(facilityId!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.DailyDispensing) {
                        RequireAccess(stockAllowed, { navController.popBackStack() }) {
                            DailyDispensingScreen(facilityId!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                    // The OTP Admission Card: the Home button shows only to OTP Officers at an OTP site;
                    // the database refuses anyone else (otp_officer_site()), so the route only checks the role.
                    val otpAllowed = currentUser.role == UserRole.Dri && facilityId != null
                    composable(Routes.OtpHome) {
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpHomeScreen(
                                onScreenChild = { navController.navigate(Routes.OtpScreening) },
                                onOpenChild = { navController.navigate(Routes.otpChild(it)) },
                                onWeeklyReport = { navController.navigate(Routes.OtpWeeklyReport) },
                                onMnp = { navController.navigate(Routes.OtpMnp) },
                                onIycf = { navController.navigate(Routes.OtpIycf) },
                                onVisits = { navController.navigate(Routes.OtpTasks) },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    composable(Routes.OtpScreening) {
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpScreeningScreen(
                                onRegistered = { code -> navController.navigate(Routes.otpChild(code)) { popUpTo(Routes.OtpHome) } },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    composable(Routes.OtpChildPattern, arguments = listOf(navArgument("childCode") { type = NavType.StringType })) { entry ->
                        val code = entry.arguments?.getString("childCode").orEmpty()
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpChildScreen(code, onRecordVisit = { navController.navigate(Routes.otpVisit(it)) },
                                onReadmit = { navController.navigate(Routes.otpReadmit(it)) }, onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.OtpVisitPattern, arguments = listOf(navArgument("childCode") { type = NavType.StringType })) { entry ->
                        val code = entry.arguments?.getString("childCode").orEmpty()
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpVisitScreen(code, onDone = { navController.popBackStack() }, onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.OtpWeeklyReport) {
                        RequireAccess(otpAllowed, { navController.popBackStack() }) { OtpWeeklyReportScreen(onExit = { navController.popBackStack() }) }
                    }
                    composable(Routes.OtpMnp) {
                        RequireAccess(otpAllowed, { navController.popBackStack() }) { OtpMnpScreen(onExit = { navController.popBackStack() }) }
                    }
                    composable(Routes.OtpIycf) {
                        RequireAccess(otpAllowed, { navController.popBackStack() }) { OtpIycfScreen(onExit = { navController.popBackStack() }) }
                    }
                    composable(Routes.OtpReadmitPattern, arguments = listOf(navArgument("childCode") { type = NavType.StringType })) { entry ->
                        val code = entry.arguments?.getString("childCode").orEmpty()
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpScreeningScreen(
                                readmitCode = code,
                                onRegistered = { navController.navigate(Routes.otpChild(it)) { popUpTo(Routes.OtpHome) } },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    composable(Routes.OtpTasks) {
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpVisitsListScreen(
                                onOpenChild = { navController.navigate(Routes.otpChild(it)) },
                                onPhoto = { visitId, folder, code -> navController.navigate(Routes.otpPhoto(visitId, code, folder)) },
                                onExit = { navController.popBackStack() },
                            )
                        }
                    }
                    composable(Routes.OtpPhotoPattern, arguments = listOf(
                        navArgument("visitId") { type = NavType.StringType }, navArgument("childCode") { type = NavType.StringType },
                        navArgument("folder") { type = NavType.StringType; defaultValue = "" },
                    )) { entry ->
                        RequireAccess(otpAllowed, { navController.popBackStack() }) {
                            OtpPhotoScreen(entry.arguments?.getString("visitId").orEmpty(), entry.arguments?.getString("folder").orEmpty(),
                                entry.arguments?.getString("childCode").orEmpty(), onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.StockCount) {
                        RequireAccess(stockAllowed, { navController.popBackStack() }) {
                            StockCountScreen(facilityId!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                    // Supervision — needs the supervisor's level (DECISIONS R34).
                    val level = currentUser.supervisionLevel
                    val superviseAllowed = MobileAccess.canSupervise(currentUser.role) && level != null
                    composable(Routes.StoreCheck) {
                        RequireAccess(superviseAllowed && level == "stores", { navController.popBackStack() }) {
                            SupervisionVisitScreen(LedgerKind.StoreCheck, level!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.OtpVerification) {
                        RequireAccess(superviseAllowed && level == "otp_sites", { navController.popBackStack() }) {
                            SupervisionVisitScreen(LedgerKind.OtpVerification, level!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                    composable(Routes.ConfirmAdjustments) {
                        RequireAccess(superviseAllowed, { navController.popBackStack() }) { ConfirmAdjustmentsScreen() }
                    }
                    composable(Routes.LossAdjustment) {
                        RequireAccess(stockAllowed, { navController.popBackStack() }) {
                            LossAdjustmentScreen(facilityId!!, onDone = backHome, onExit = { navController.popBackStack() })
                        }
                    }
                }
            }
        }

        TpmToast(
            message = toastState.message,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 72.dp, start = 16.dp, end = 16.dp), // Raised above bottom nav
        )

        if (profileSheetOpen) {
            val scope = rememberCoroutineScope()
            ProfileSheet(
                userName = currentUser.name,
                userInitials = userInitials,
                userSubtitle = currentUser.email,
                isDemoOffline = demoOffline == true,
                onSetDemoOffline = { session.setDemoOffline(it) },
                onLogout = { scope.launch { session.logout() }; profileSheetOpen = false },
                onDismiss = { profileSheetOpen = false },
                showConnectivityOverride = BuildConfig.DEBUG,
                pendingSyncCount = pendingSyncCount,
                onClearDeviceAccess = { scope.launch { session.clearDeviceAccess() }; profileSheetOpen = false },
            )
        }

        // Sign-out after 15 minutes without use, with a one-minute warning (DPIA R2, R168).
        InactivityGuard(session)
      }
    }
}

/** Belt-and-braces route guard: the buttons that lead to these wizards are already hidden per
 *  [MobileAccess], this makes sure a role without the capability can't reach one any other way
 *  (a stale back-stack entry, a future deep link). The server's RLS/RPC guards are the real
 *  boundary either way. */
@Composable
private fun RequireAccess(allowed: Boolean, onDenied: () -> Unit, content: @Composable () -> Unit) {
    if (allowed) content() else LaunchedEffect(Unit) { onDenied() }
}

private fun NavController.navigateTopLevel(route: String) {
    navigate(route) {
        popUpTo(graph.startDestinationId) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

private fun headerTitleFor(route: String?, role: UserRole, issueIdArg: String?): String = when {
    route == null -> ""
    route == Routes.Home -> "RUTF Monitoring"
    route.startsWith("issueList") -> when {
        role == UserRole.FieldMonitor -> "My Registered Findings"
        MobileAccess.isOversightRole(role) -> "Findings"
        else -> "Assigned Findings"
    }
    route == Routes.Map -> "Finding Map"
    route == Routes.Notifications -> "Notifications"
    route == Routes.SyncQueue -> "Sync Queue"
    route.startsWith("issueDetail") -> issueIdArg ?: "Finding"
    route == Routes.NewIssueWizard -> "Register Finding"
    route.startsWith("driRespondWizard") -> "Officer Response"
    route.startsWith("finalVerifyWizard") -> "Final Verification"
    route == Routes.OtpHome -> "OTP Admission Card"
    route == Routes.OtpScreening -> "Screening"
    route.startsWith("otpChild") -> "Child's Card"
    route == Routes.OtpTasks -> "Visits and Tasks"
    route.startsWith("otpReadmit") -> "Re-admission"
    route.startsWith("otpPhoto") -> "RUTF Photo"
    route.startsWith("otpVisit") -> "OTP Visit"
    route == Routes.OtpWeeklyReport -> "Weekly OTP Report"
    route == Routes.OtpMnp -> "MNP"
    route == Routes.OtpIycf -> "IYCF / Health Education"
    else -> ""
}

private fun bottomNavItems(role: UserRole, pendingSyncCount: Int, unreadNotifications: Boolean): List<BottomNavEntry> = listOf(
    BottomNavEntry(Routes.Home, "Home", Icons.Filled.Home),
    BottomNavEntry(
        Routes.IssueList,
        when {
            role == UserRole.FieldMonitor -> "My Findings"
            MobileAccess.isOversightRole(role) -> "Findings"
            else -> "Assigned"
        },
        Icons.Filled.List,
    ),
    BottomNavEntry(Routes.Map, "Map", Icons.Filled.Map),
    BottomNavEntry(Routes.SyncQueue, "Sync", Icons.Filled.Cloud, badge = pendingSyncCount > 0),
    BottomNavEntry(Routes.Notifications, "Alerts", Icons.Filled.Notifications, badge = unreadNotifications),
)
