package org.tpmnigeria.tpm.data.remote

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.storage.Storage
import org.tpmnigeria.tpm.BuildConfig

/**
 * Single Supabase client for the TPM Monitoring Platform project — same backend the Next.js web
 * app (`../TPM Monitoring Platform Design/web`) uses. URL/anon key come from local.properties via
 * BuildConfig (see app/build.gradle.kts) — never hardcoded, never committed.
 */
object Supabase {
    val client = createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
    ) {
        install(Postgrest)
        install(Auth) {
            // Redirect target for invitation/password-reset emails — must match what's configured
            // as the Supabase Auth redirect URL in the dashboard. See AndroidManifest.xml's
            // intent-filter and MainActivity.handleAuthDeepLink.
            scheme = "tpmapp"
            host = "auth-callback"
        }
        install(Storage)
        install(Realtime)
    }
}

/** The evidence-photo storage bucket — see supabase/migrations/0010_storage.sql. */
const val ISSUE_EVIDENCE_BUCKET = "issue-evidence"

/** Daily Attendance's selfie + assignment-location-photo bucket — see
 *  supabase/migrations/0037_field_monitor_attendance.sql. */
const val ATTENDANCE_EVIDENCE_BUCKET = "attendance-evidence"

/** Private bucket for stock evidence (waybills, stock cards, register pages) — web migration 0101. */
const val LEDGER_EVIDENCE_BUCKET = "ledger-evidence"
