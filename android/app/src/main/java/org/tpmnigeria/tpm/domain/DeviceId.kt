package org.tpmnigeria.tpm.domain

import android.content.Context
import android.provider.Settings

/**
 * Device identifier recorded with ledger entries and visits, and sent with sync status reports
 * (web migrations 0101, 0103, 0108) — the master prompt explicitly forbids reading a
 * true hardware IMEI (READ_PHONE_STATE + a privileged/carrier-signed permission on modern
 * Android, and blocked outright for regular apps since Android 10) and requires "the approved
 * persistent device identifier already supported by the application's architecture" instead.
 *
 * `Settings.Secure.ANDROID_ID` is that identifier: a 64-bit hex string, unique per
 * app-signing-key + user + device, persists across app reinstalls (but not a factory reset or a
 * signing-key change) — exactly what "same physical device submitting under different accounts"
 * detection needs, with no extra runtime permission and no privacy/platform-policy violation.
 */
fun androidDeviceId(context: Context): String =
    Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown-device"
