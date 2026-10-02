package org.tpmnigeria.tpm.ui.navigation

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
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.sync.SyncScheduler
import org.tpmnigeria.tpm.ui.LocalAppRepository
import org.tpmnigeria.tpm.ui.components.BottomNavEntry
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
import org.tpmnigeria.tpm.ui.wizard.attendance.DailyAttendanceScreen
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
            topBar = {
                Column(modifier = Modifier.statusBarsPadding()) {
                    TpmHeader(
                        title = headerTitle,
                        showBack = !isTopLevel,
                        onBack = { headerBackOverride.value?.invoke() ?: navController.popBackStack() },
                        userInitials = userInitials,
                        onAvatarClick = { profileSheetOpen = true },
                        rolePill = if (currentRoute == Routes.Home) currentUser.role.label else null,
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
                            onStartAttendance = { navController.navigate(Routes.DailyAttendance) },
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
                    composable(Routes.DailyAttendance) {
                        RequireAccess(MobileAccess.canCaptureAttendance(currentUser.role), { navController.popBackStack() }) {
                            DailyAttendanceScreen(
                                onDone = {
                                    SyncScheduler.syncNow(context)
                                    navController.popBackStack(Routes.Home, inclusive = false)
                                },
                                onExit = { navController.popBackStack() },
                            )
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
    route.startsWith("driRespondWizard") -> "DRI Response"
    route.startsWith("finalVerifyWizard") -> "Final Verification"
    route == Routes.DailyAttendance -> "Daily Attendance"
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
