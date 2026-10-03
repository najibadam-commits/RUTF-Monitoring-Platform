package org.tpmnigeria.tpm.domain

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The Findings a supervision visit will raise, worked out on the phone for the wizard's review
 * step (brief §8: "review showing the Findings this visit will raise"). Mirrors web migration
 * 0103's evaluate_visit_internal with the brief's default thresholds (§12.4); the server applies
 * the programme's own thresholds and has the final say.
 */
data class PreviewFinding(val type: String, val label: String, val detail: String)

data class VisitCount(val ledger: Int?, val counted: Int, val expired: Int)

data class StoreChecklist(
    val stockCardPresent: Boolean,
    val stockCardUpToDate: Boolean?,
    val storageDry: Boolean?,
    val storageOffFloor: Boolean?,
    val pestsSeen: Boolean?,
)

data class OtpRecount(val registerPresent: Boolean, val dispensedCounted: Int?, val dispensedRecorded: Int)

object VisitThresholds {
    const val VARIANCE_PCT = 5.0
    const val VARIANCE_PCT_REMOTE = 10.0
    const val VF_MIN = 0.90
    const val VF_MAX = 1.10
    const val GEOFENCE_M = 150
}

fun previewVisitFindings(
    counts: List<VisitCount>,
    hardToReach: Boolean,
    store: StoreChecklist? = null,
    otp: OtpRecount? = null,
): List<PreviewFinding> = buildList {
    val ledger = counts.sumOf { it.ledger ?: 0 }
    val counted = counts.sumOf { it.counted }
    val limit = if (hardToReach) VisitThresholds.VARIANCE_PCT_REMOTE else VisitThresholds.VARIANCE_PCT
    if (ledger > 0) {
        val pct = abs(ledger - counted) * 100.0 / ledger
        if (pct > limit) add(PreviewFinding("stock_variance", "Stock variance", "Counted ${"%,d".format(counted)} vs ${"%,d".format(ledger)} in the ledger — ${"%.1f".format(pct)}% (limit ${limit.toInt()}%)."))
    }
    val expired = counts.sumOf { it.expired }
    if (expired > 0) add(PreviewFinding("expired_stock", "Expired stock held", "${"%,d".format(expired)} expired sachets on the shelf."))

    store?.let { s ->
        if (!s.stockCardPresent || s.stockCardUpToDate == false) {
            add(PreviewFinding("no_stock_card", "No stock card", if (!s.stockCardPresent) "No stock card." else "Stock card not up to date."))
        }
        val problems = listOfNotNull(
            "store not dry".takeIf { s.storageDry == false },
            "stock on the floor".takeIf { s.storageOffFloor == false },
            "signs of pests".takeIf { s.pestsSeen == true },
        )
        if (problems.isNotEmpty()) add(PreviewFinding("poor_storage", "Poor storage", problems.joinToString(", ").replaceFirstChar { it.uppercase() } + "."))
    }

    otp?.let { o ->
        if (!o.registerPresent) {
            add(PreviewFinding("register_missing", "Register missing", "The OTP register was not available."))
        } else if (o.dispensedCounted != null && o.dispensedRecorded > 0) {
            val vf = verificationFactor(o.dispensedCounted, o.dispensedRecorded)
            if (vf < VisitThresholds.VF_MIN || vf > VisitThresholds.VF_MAX) {
                add(PreviewFinding("dispensing_gap", "Dispensing gap (OTP VF)",
                    "Register ${"%,d".format(o.dispensedCounted)} vs app ${"%,d".format(o.dispensedRecorded)} — VF ${"%.2f".format(vf)} (range 0.90–1.10)."))
            }
        }
    }
}

/** OTP VF = supervisor's register count ÷ app-recorded dispensing, 2 decimals (brief §7). */
fun verificationFactor(counted: Int, recorded: Int): Double = (counted.toDouble() / recorded * 100).roundToInt() / 100.0

/** Great-circle distance in metres — the geofence warning while still on the GPS step. */
fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Int {
    val r = 6_371_008.8
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
    return (2 * r * asin(sqrt(a))).roundToInt()
}
