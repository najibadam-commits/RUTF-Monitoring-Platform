package org.tpmnigeria.tpm.domain

import kotlin.math.roundToLong

/** "2 days ago" / "1 day ago" / "just now" style relative time for notification rows. */
fun relativeTimeString(timestampMillis: Long, nowMillis: Long = System.currentTimeMillis()): String {
    val diffMs = (nowMillis - timestampMillis).coerceAtLeast(0)
    val minutes = diffMs / 60_000.0
    val hours = minutes / 60.0
    val days = hours / 24.0
    val weeks = days / 7.0
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "${minutes.roundToLong()} min ago"
        hours < 24 -> "${hours.roundToLong()} hour${if (hours.roundToLong() == 1L) "" else "s"} ago"
        days < 7 -> "${days.roundToLong()} day${if (days.roundToLong() == 1L) "" else "s"} ago"
        else -> "${weeks.roundToLong()} week${if (weeks.roundToLong() == 1L) "" else "s"} ago"
    }
}
