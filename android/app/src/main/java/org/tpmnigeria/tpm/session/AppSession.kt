package org.tpmnigeria.tpm.session

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthErrorCode
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionSource
import io.github.jan.supabase.auth.parseSessionFromUrl
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.tpmnigeria.tpm.BuildConfig
import org.tpmnigeria.tpm.data.ReferenceRepository
import org.tpmnigeria.tpm.data.remote.Supabase
import org.tpmnigeria.tpm.data.remote.dto.ProfileDto
import org.tpmnigeria.tpm.domain.PasswordHash
import org.tpmnigeria.tpm.domain.model.UserRole
import org.tpmnigeria.tpm.sync.SyncScheduler

data class CurrentUser(
    val id: String,
    val name: String,
    val email: String,
    val role: UserRole,
    val projectId: String?,
    /** The facility a facility user (dri) records for — null for every other role. */
    val facilityId: String? = null,
    /** For a supervisor: "stores" or "otp_sites" (web migration 0103) — what they supervise in their LGAs. */
    val supervisionLevel: String? = null,
)

/** Short, user-facing text for a real (online) sign-in rejection from Supabase Auth —
 *  AuthRestException's own `.message` is a raw debug dump (request URL, headers, HTTP method),
 *  never something to show a field user. Falls back to [AuthRestException.errorDescription] —
 *  still Supabase's own wording, but at least not the full request dump — for a code this app
 *  doesn't have specific copy for. */
private fun friendlyAuthErrorMessage(e: AuthRestException): String = when (e.errorCode) {
    AuthErrorCode.InvalidCredentials -> "Incorrect email or password."
    AuthErrorCode.UserNotFound -> "No account found with that email."
    AuthErrorCode.UserBanned -> "This account has been disabled — contact your administrator."
    AuthErrorCode.EmailProviderDisabled, AuthErrorCode.SignupDisabled -> "Sign-in is currently unavailable — contact your administrator."
    AuthErrorCode.OverEmailSendRateLimit -> "Too many attempts — please wait a moment and try again."
    else -> e.errorDescription.ifBlank { "Login failed — please check your email and password and try again." }
}

/**
 * Real Supabase Auth session — the same platform accounts and `profiles.role` values as the web
 * dashboard, no mobile-only accounts. See [UserRole] for the role list ("Field Monitor" is
 * profiles.role = 'tpm_supervisor'). Every role except `viewer` may sign in; what each one can
 * then do is [org.tpmnigeria.tpm.domain.MobileAccess]'s job, and the real enforcement is the
 * server's RLS/RPC guards — see DECISIONS.md #31 in the web project (supersedes the role
 * restriction in #7).
 */
class AppSession(
    private val appContext: Context,
    private val referenceRepository: ReferenceRepository,
) {
    private val auth get() = Supabase.client.auth
    private val postgrest get() = Supabase.client.postgrest
    private val prefs = appContext.getSharedPreferences("session_cache", Context.MODE_PRIVATE)

    private val _currentUser = MutableStateFlow<CurrentUser?>(null)
    val currentUser: StateFlow<CurrentUser?> = _currentUser.asStateFlow()

    val loggedIn: StateFlow<Boolean> get() = _loggedIn.asStateFlow()
    private val _loggedIn = MutableStateFlow(false)

    /** Demo-only manual offline override — only ever shown behind BuildConfig.DEBUG in the
     *  profile sheet (see ProfileSheet's showDemoControls); null means "trust ConnectivityManager". */
    private val _demoOfflineOverride = MutableStateFlow<Boolean?>(null)
    val demoOfflineOverride: StateFlow<Boolean?> = _demoOfflineOverride.asStateFlow()

    /** True while MainActivity has just handled an invitation/password-reset deep link and the
     *  user needs to set a new password before doing anything else — see handleAuthDeepLink. */
    private val _passwordRecoveryPending = MutableStateFlow(false)
    val passwordRecoveryPending: StateFlow<Boolean> = _passwordRecoveryPending.asStateFlow()

    private var pendingRecoveryEmail: String? = null

    init {
        restoreCachedProfile()
    }

    private fun restoreCachedProfile() {
        val id = prefs.getString("user_id", null) ?: return
        val name = prefs.getString("user_name", "") ?: ""
        val email = prefs.getString("user_email", "") ?: ""
        val roleStr = prefs.getString("user_role", "") ?: ""
        val projectId = prefs.getString("project_id", null)
        val facilityId = prefs.getString("facility_id", null)
        val supervisionLevel = prefs.getString("supervision_level", null)
        
        val role = UserRole.entries.firstOrNull { it.name == roleStr } ?: return
        _currentUser.value = CurrentUser(id, name, email, role, projectId, facilityId, supervisionLevel)
    }

    private fun cacheProfile(user: CurrentUser) {
        prefs.edit()
            .putString("user_id", user.id)
            .putString("user_name", user.name)
            .putString("user_email", user.email)
            .putString("user_role", user.role.name)
            .putString("project_id", user.projectId)
            .putString("facility_id", user.facilityId)
            .putString("supervision_level", user.supervisionLevel)
            .apply()
    }

    /** Call once at app startup — supabase-kt persists the session locally and restores it
     *  automatically; this just re-fetches the profile row so [currentUser] is populated without
     *  forcing the user through Login again. */
    suspend fun restoreSession() {
        val userId = auth.currentUserOrNull()?.id
        if (userId != null) {
            loadProfile(userId).onSuccess {
                _loggedIn.value = true
                refreshReferenceDataQuietly()
                SyncScheduler.syncNow(appContext)
            }.onFailure {
                // If network fails but we have a cached user that matches the session id, allow
                // entering the app offline — this continues an already-real, already-authenticated
                // Supabase session (its JWT/refresh token, not a fresh credential entry), so it
                // doesn't need a password check. It IS bounded by the offline grace period though:
                // an account revoked/deactivated on the web has to eventually get re-checked.
                if (_currentUser.value?.id == userId && withinOfflineGracePeriod()) {
                    _loggedIn.value = true
                }
            }
        } else if (_currentUser.value != null && isEffectivelyOffline() && withinOfflineGracePeriod()) {
            // No active Supabase session but we have a cached profile and we are offline.
            // This allows the app to be used in the field even if the JWT expired.
            _loggedIn.value = true
        }
    }

    suspend fun signIn(email: String, password: String): Result<Unit> {
        val trimmedEmail = email.trim()
        if (!isNetworkConnected() || isEffectivelyOffline()) {
            return signInOffline(trimmedEmail, password)
        }

        return try {
            auth.signInWith(Email) {
                this.email = trimmedEmail
                this.password = password
            }
            val userId = auth.currentUserOrNull()?.id
                ?: return Result.failure(IllegalStateException("Sign-in failed — please try again."))
            loadProfile(userId)
                .onSuccess {
                    _loggedIn.value = true
                    // The password Supabase Auth just accepted is known-correct right now — this
                    // is the only point at which it's safe to derive a local verification hash
                    // from it (see PasswordHash's kdoc / the offline sign-in bypass this replaces).
                    cacheOfflineCredential(password)
                    refreshReferenceDataQuietly()
                    SyncScheduler.syncNow(appContext)
                }
                .map {}
        } catch (e: AuthRestException) {
            // The request reached Supabase and it responded — wrong password, unknown account,
            // rate-limited, etc. This is a REAL online result, not a connectivity problem, so it
            // must surface as-is rather than falling back to the offline path: that path's own
            // errors ("no matching cached account", grace period, ...) would otherwise silently
            // replace and hide the actual reason a genuinely-online sign-in failed — exactly what
            // happened when signing into a *different* account than the one cached on this device
            // while online, which should say "wrong password"/"no such account", not "offline".
            // friendlyAuthErrorMessage swaps AuthRestException's raw message (URL/headers/HTTP
            // method — not something a field user should ever see) for a short, specific one.
            Result.failure(IllegalStateException(friendlyAuthErrorMessage(e), e))
        } catch (e: Exception) {
            // Everything else here is a real connectivity failure (timeout, DNS, no route, etc.)
            // — the request never got a response from Supabase at all — so falling back to the
            // offline path is the right call; from the user's perspective this is indistinguishable
            // from "the device has no signal right now."
            signInOffline(trimmedEmail, password)
        }
    }

    /** Real (if locally-scoped) credential check — replaces a prior version of this function that
     *  accepted ANY password as long as the typed email matched the last cached one, which meant
     *  offline "login" required no password at all. See PasswordHash's kdoc. Also enforces the
     *  offline grace period: an offline-cached account can't be used to sign in forever without
     *  ever re-touching the server — see withinOfflineGracePeriod. */
    private fun signInOffline(trimmedEmail: String, password: String): Result<Unit> {
        val cachedEmail = prefs.getString("user_email", null)
        if (cachedEmail == null || !cachedEmail.equals(trimmedEmail, ignoreCase = true)) {
            return Result.failure(IllegalStateException("No matching account cached for offline use. You must log in online with this email once."))
        }
        if (!withinOfflineGracePeriod()) {
            return Result.failure(
                IllegalStateException("This device hasn't verified your account online in a while. Please connect to the internet once to continue."),
            )
        }
        val stored = loadOfflineCredential()
            ?: return Result.failure(IllegalStateException("This device has no offline credential saved yet. You must log in online with this email once."))
        if (!PasswordHash.verify(password, stored)) {
            return Result.failure(IllegalStateException("Incorrect password."))
        }
        restoreCachedProfile() // Ensure _currentUser is populated
        _loggedIn.value = true
        return Result.success(Unit)
    }

    private fun cacheOfflineCredential(password: String) {
        val hashed = PasswordHash.hash(password)
        prefs.edit()
            .putString("offline_pw_hash", hashed.hash)
            .putString("offline_pw_salt", hashed.salt)
            .putInt("offline_pw_iterations", hashed.iterations)
            .putLong("last_online_auth_millis", System.currentTimeMillis())
            .apply()
    }

    private fun loadOfflineCredential(): PasswordHash.Hashed? {
        val hash = prefs.getString("offline_pw_hash", null) ?: return null
        val salt = prefs.getString("offline_pw_salt", null) ?: return null
        val iterations = prefs.getInt("offline_pw_iterations", -1).takeIf { it > 0 } ?: return null
        return PasswordHash.Hashed(hash, salt, iterations)
    }

    /** Offline access is a continuity feature for field work, not a permanent bypass of the
     *  server — see the production-stabilization audit's Section 5. Bounded to 30 days since the
     *  last successful ONLINE authentication (sign-in, session restore, or password reset); after
     *  that, the app requires connectivity once to re-verify the account (e.g. catches a revoked/
     *  deactivated account within a bounded window instead of never). 30 days is deliberately
     *  generous for genuinely remote field conditions — tune via [OFFLINE_GRACE_PERIOD_MILLIS] if
     *  that's wrong for a given deployment. */
    private fun withinOfflineGracePeriod(): Boolean {
        val lastOnline = prefs.getLong("last_online_auth_millis", -1L)
        if (lastOnline <= 0L) return false
        return System.currentTimeMillis() - lastOnline <= OFFLINE_GRACE_PERIOD_MILLIS
    }

    /** A failed refresh shouldn't block login — the wizards fall back to whatever was cached
     *  from a previous session (or stay empty until connectivity returns, same as any other
     *  offline-first read). */
    private suspend fun refreshReferenceDataQuietly() {
        runCatching { referenceRepository.refreshCoreReferenceData() }
    }

    private suspend fun loadProfile(userId: String): Result<CurrentUser> {
        return try {
            val profile = postgrest.from("profiles")
                .select(columns = Columns.list("id", "name", "email", "role", "project_id", "status", "facility_id", "supervision_level")) {
                    filter { eq("id", userId) }
                }
                .decodeSingle<ProfileDto>()

            if (profile.status != "active") {
                auth.signOut()
                return Result.failure(IllegalStateException("Your account is inactive — contact your administrator."))
            }
            val role = UserRole.fromDbValue(profile.role) ?: run {
                auth.signOut()
                return Result.failure(
                    IllegalStateException("Your account role doesn't have access to the mobile app. Sign in to the web dashboard instead."),
                )
            }
            val user = CurrentUser(profile.id, profile.name, profile.email, role, profile.project_id, profile.facility_id, profile.supervision_level)
            _currentUser.value = user
            cacheProfile(user)
            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Normal logout — ends the active session but deliberately keeps the cached
     *  profile+credential-hash so the *same* person can sign back in on this device while
     *  offline (real field requirement). This does NOT protect the device from a second person —
     *  use [clearDeviceAccess] for that. */
    suspend fun logout() {
        try {
            auth.signOut()
        } catch (e: Exception) {
            // Ignore network errors during sign out — we still want to clear local state
            // so the user is returned to the login screen.
        }
        _currentUser.value = null
        _loggedIn.value = false
        _demoOfflineOverride.value = null
        // NOTE: We deliberately do not clear the shared preferences here — see clearDeviceAccess
        // for the action that does.
    }

    /** "Clear device access" — wipes every trace of this account from the device (cached
     *  profile, the offline password-verification hash, the offline grace-period timestamp), so
     *  a subsequent user can't inherit this session offline and this account can't be used to
     *  sign in offline again until someone logs in online with it once more. Callers should warn
     *  about (and this deliberately does NOT check) unsynced sync_queue items first — see
     *  ProfileSheet, which checks AppRepository.observePendingSyncCount() before calling this, so
     *  a device is never wiped out from under genuinely pending field data. */
    suspend fun clearDeviceAccess() {
        logout()
        prefs.edit().clear().apply()
    }

    fun setDemoOffline(offline: Boolean?) {
        _demoOfflineOverride.value = offline
    }

    suspend fun sendPasswordResetEmail(email: String): Result<Unit> {
        return try {
            auth.resetPasswordForEmail(email)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Called from MainActivity when the app receives the `tpmapp://auth-callback` deep link —
     *  the redirect target for both Supabase's invitation email and its "forgot password" email
     *  (see AndroidManifest.xml's intent-filter and Supabase.kt's Auth `scheme`/`host` config).
     *  Supabase encodes the session directly in the URL fragment (implicit flow) along with a
     *  `type` of "recovery" or "invite" — both mean the same thing here: the user must set a new
     *  password before doing anything else. Returns true if this was recognized as a recovery/
     *  invite link (regardless of success — [passwordRecoveryPending]/errors distinguish that).
     */
    suspend fun handleAuthDeepLink(url: String): Boolean {
        return try {
            val session = auth.parseSessionFromUrl(url)
            if (session.type != "recovery" && session.type != "invite") return false
            auth.importSession(session, source = SessionSource.External)
            pendingRecoveryEmail = auth.currentUserOrNull()?.email
            _passwordRecoveryPending.value = true
            true
        } catch (e: Exception) {
            // Malformed or expired link (e.g. the user tapped it a second time, or it's more than
            // an hour old) — nothing to recover into; the user stays wherever they already were
            // (typically Login) rather than the app silently doing nothing with no explanation.
            false
        }
    }

    /** Submits the new password for the account currently mid-recovery (see
     *  [handleAuthDeepLink]/[passwordRecoveryPending]). Signs the user back out afterward — by
     *  design (see the Set Password screen's spec) they land on Login and sign in normally with
     *  the new password, rather than this silently continuing as a logged-in session. */
    suspend fun completePasswordReset(newPassword: String): Result<Unit> {
        return try {
            auth.updateUser { password = newPassword }
            _passwordRecoveryPending.value = false
            pendingRecoveryEmail = null
            auth.signOut()
            _currentUser.value = null
            _loggedIn.value = false
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** User backed out of Set Password without finishing — same as an ordinary sign-out of
     *  whatever recovery session was mid-flight. */
    suspend fun cancelPasswordRecovery() {
        _passwordRecoveryPending.value = false
        pendingRecoveryEmail = null
        try { auth.signOut() } catch (e: Exception) { /* best-effort */ }
        _currentUser.value = null
        _loggedIn.value = false
    }

    /** True network state via ConnectivityManager — the production signal (README §11). */
    fun isNetworkConnected(): Boolean {
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** What the app should actually treat as "offline right now" — demo override's actual value
     *  wins if set (debug builds only; see ProfileSheet), otherwise real connectivity. */
    fun isEffectivelyOffline(): Boolean {
        val override = if (BuildConfig.DEBUG) _demoOfflineOverride.value else null
        return override ?: !isNetworkConnected()
    }

    companion object {
        private const val OFFLINE_GRACE_PERIOD_MILLIS = 30L * 24 * 60 * 60 * 1000 // 30 days
    }
}
