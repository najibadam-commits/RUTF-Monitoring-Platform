package org.tpmnigeria.tpm.ui.navigation

/**
 * Route constants for Navigation Compose. Top-level routes show the bottom nav bar; everything
 * else is a pushed screen with a back arrow (see topLevelKeyOf in AppNavHost.kt).
 *
 * No URL-encoding on issueId/filter here: Issue IDs are always `LGA3-WARD3-CAT3-YY-INITIALS###`
 * (letters/digits/hyphens only, see IssueIdGenerator.kt) and filter names are our own enum-like
 * strings — neither ever contains characters that need escaping as a path/query segment.
 */
object Routes {
    const val Login = "login"
    const val Home = "home"
    const val Map = "map"
    const val Notifications = "notifications"
    const val SyncQueue = "syncQueue"

    const val IssueListPattern = "issueList?filter={filter}"
    const val IssueList = "issueList" // top-level key used for bottom-nav matching
    fun issueList(filter: String? = null) = if (filter != null) "issueList?filter=$filter" else "issueList"

    const val IssueDetailPattern = "issueDetail/{issueId}?justRegistered={justRegistered}"
    fun issueDetail(issueId: String, justRegistered: Boolean = false) =
        "issueDetail/$issueId?justRegistered=$justRegistered"

    const val NewIssueWizard = "newIssueWizard"

    // Facility stock recording (facility users — brief §8).
    const val MyStock = "myStock"
    const val ReceiveStock = "receiveStock"
    const val IssueStock = "issueStock"
    const val DailyDispensing = "dailyDispensing"
    const val StockCount = "stockCount"
    const val LossAdjustment = "lossAdjustment"

    // Supervision (supervisors — brief §8).
    const val StoreCheck = "storeCheck"
    const val OtpVerification = "otpVerification"
    const val ConfirmAdjustments = "confirmAdjustments"

    const val DriRespondWizardPattern = "driRespondWizard?issueId={issueId}"
    fun driRespondWizard(issueId: String? = null) = if (issueId != null) "driRespondWizard?issueId=$issueId" else "driRespondWizard"

    // Digital OTP Admission Card (OTP Officers at an OTP site; RUTF DECISIONS R145). Child IDs are
    // letters, digits and hyphens only (e.g. KT-DAU-26-00042), so they need no escaping.
    const val OtpHome = "otpHome"
    const val OtpScreening = "otpScreening"
    const val OtpChildPattern = "otpChild/{childCode}"
    fun otpChild(childCode: String) = "otpChild/$childCode"
    const val OtpVisitPattern = "otpVisit/{childCode}"
    fun otpVisit(childCode: String) = "otpVisit/$childCode"

    const val FinalVerifyWizardPattern = "finalVerifyWizard?issueId={issueId}"
    fun finalVerifyWizard(issueId: String? = null) = if (issueId != null) "finalVerifyWizard?issueId=$issueId" else "finalVerifyWizard"
}
