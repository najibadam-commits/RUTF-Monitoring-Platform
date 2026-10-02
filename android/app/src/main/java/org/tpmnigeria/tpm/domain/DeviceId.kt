package org.tpmnigeria.tpm.domain

import android.content.Context
import android.provider.Settings

/**
 * Legally/technically available device identifier for Daily Attendance's device-reuse signal
 * (see DECISIONS.md #24 in the web project) — the master prompt explicitly forbids reading a
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
