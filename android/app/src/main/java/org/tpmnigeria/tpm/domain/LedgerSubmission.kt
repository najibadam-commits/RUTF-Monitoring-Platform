package org.tpmnigeria.tpm.domain

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put


/**
 * One facility stock submission waiting in the sync queue (its payloadJson). [rpc] + [params] are
 * exactly the server call (web migration 0101's record_* functions); [localId] is the idempotency
 * key the server stores, so a retried sync can never record it twice. [lines] are kept alongside
 * for the offline projection (My Stock, Stock Count) and the Sync Queue label.
 */
@Serializable
data class LedgerSubmission(
    val kind: LedgerKind,
    val localId: String,
    val facilityId: String,
    val rpc: String,
    val params: JsonObject,
    val txnDate: String,
    val lines: List<LedgerLine> = emptyList(),
    val photos: List<LedgerPhoto> = emptyList(),
    val summary: String,
    /** Dispensing only: total dispensed (the server allocates it to lots). */
    val sachetsDispensed: Int = 0,
    /** Loss/adjustment only: the txn_type (adjustments are signed). */
    val lossType: String? = null,
)

@Serializable
enum class LedgerKind { Receipt, Issue, Dispensing, StockCount, Loss, StoreCheck, OtpVerification, ConfirmAdjustment }

/** Supervision kinds (web migration 0103) carry no stock movement of their own. */
val LedgerKind.isSupervision: Boolean get() = this == LedgerKind.StoreCheck || this == LedgerKind.OtpVerification || this == LedgerKind.ConfirmAdjustment

/** A lot line. [lotId] for a lot already in the list, else [lotNo] + [expiryDate] as read off the
 *  carton (the server adds it — DECISIONS R22). For a count, [quantity] is the physical count. */
@Serializable
data class LedgerLine(
    val lotId: String? = null,
    val lotNo: String? = null,
    val expiryDate: String? = null,
    val quantity: Int,
    val damaged: Int = 0,
) {
    /** Same key StockBalanceEntity uses, with not-yet-listed lots keyed by their printed number. */
    val lotKey: String get() = lotId ?: lotNo?.let { "new:${it.trim().uppercase()}" } ?: ""
}

@Serializable
data class LedgerPhoto(val localPath: String, val kind: String)

private fun linesJson(lines: List<LedgerLine>, countField: Boolean = false): JsonArray = buildJsonArray {
    for (l in lines) add(buildJsonObject {
        l.lotId?.let { put("lot_id", it) }
        l.lotNo?.let { put("lot_no", it.trim()) }
        l.expiryDate?.let { put("expiry_date", it) }
        if (countField) put("physical_count", l.quantity) else put("quantity", l.quantity)
        if (l.damaged > 0) put("damaged", l.damaged)
    })
}

/** A supervisor's count of one lot at a visit (web migration 0103's stock_check_lines). */
@Serializable
data class VisitCountLine(
    val lotId: String? = null,
    val lotNo: String? = null,
    val expiryDate: String? = null,
    val stockCardBalance: Int? = null,
    val physicalCount: Int,
    val damagedCount: Int = 0,
    val expiredCount: Int = 0,
)

/** Builders: one per record_* function, parameter names exactly as in migrations 0101 / 0103. */
object LedgerSubmissions {
    /** A supervision visit — record_visit (0103). [checklist] keys as the migration documents. */
    fun visit(
        kind: LedgerKind, localId: String, facilityId: String, date: String, lat: Double, lng: Double, accuracyM: Int,
        lines: List<VisitCountLine>, checklist: JsonObject, periodStart: String?, periodEnd: String?, deviceId: String,
        photos: List<LedgerPhoto>, summary: String,
    ) = LedgerSubmission(
        kind = kind, localId = localId, facilityId = facilityId, rpc = "record_visit", txnDate = date,
        photos = photos, summary = summary,
        params = buildJsonObject {
            put("p_local_id", localId)
            put("p_visit_type", if (kind == LedgerKind.StoreCheck) "store_check" else "otp_verification")
            put("p_facility_id", facilityId); put("p_visit_date", date)
            put("p_lat", lat); put("p_lng", lng); put("p_gps_accuracy_m", accuracyM)
            put("p_lines", buildJsonArray {
                for (l in lines) add(buildJsonObject {
                    l.lotId?.let { put("lot_id", it) }
                    l.lotNo?.let { put("lot_no", it.trim()) }
                    l.expiryDate?.let { put("expiry_date", it) }
                    l.stockCardBalance?.let { put("stock_card_balance", it) }
                    put("physical_count", l.physicalCount)
                    put("damaged_count", l.damagedCount)
                    put("expired_count", l.expiredCount)
                })
            })
            put("p_checklist", checklist)
            put("p_period_start", periodStart); put("p_period_end", periodEnd)
            put("p_device_id", deviceId)
        },
    )

    /** A supervisor confirms a facility's adjustment — confirm_adjustment (0103). */
    fun confirmAdjustment(localId: String, facilityId: String, adjustmentId: String, note: String?, date: String, summary: String) = LedgerSubmission(
        kind = LedgerKind.ConfirmAdjustment, localId = localId, facilityId = facilityId, rpc = "confirm_adjustment", txnDate = date,
        summary = summary,
        params = buildJsonObject { put("p_txn_id", adjustmentId); put("p_note", note?.takeIf { it.isNotBlank() }) },
    )

    fun receipt(
        localId: String, facilityId: String, date: String, lines: List<LedgerLine>, transferId: String?,
        documentNo: String?, deviceId: String, photos: List<LedgerPhoto>, summary: String,
    ) = LedgerSubmission(
        kind = LedgerKind.Receipt, localId = localId, facilityId = facilityId, rpc = "record_receipt", txnDate = date,
        lines = lines, photos = photos, summary = summary,
        params = buildJsonObject {
            put("p_local_id", localId); put("p_facility_id", facilityId); put("p_txn_date", date)
            put("p_lines", linesJson(lines))
            put("p_transfer_id", transferId?.let(::JsonPrimitive) ?: JsonNull)
            put("p_document_no", documentNo?.takeIf { it.isNotBlank() }); put("p_device_id", deviceId)
        },
    )

    fun issue(
        localId: String, facilityId: String, toFacilityId: String, date: String, lines: List<LedgerLine>,
        documentNo: String?, deviceId: String, photos: List<LedgerPhoto>, summary: String,
    ) = LedgerSubmission(
        kind = LedgerKind.Issue, localId = localId, facilityId = facilityId, rpc = "record_issue", txnDate = date,
        lines = lines, photos = photos, summary = summary,
        params = buildJsonObject {
            put("p_local_id", localId); put("p_facility_id", facilityId); put("p_to_facility_id", toFacilityId)
            put("p_txn_date", date); put("p_lines", linesJson(lines))
            put("p_document_no", documentNo?.takeIf { it.isNotBlank() }); put("p_device_id", deviceId)
        },
    )

    fun dispensing(
        localId: String, facilityId: String, date: String, newAdmissions: Int, childrenSeen: Int,
        prescribed: Int, dispensed: Int, deviceId: String, photos: List<LedgerPhoto>, summary: String,
    ) = LedgerSubmission(
        kind = LedgerKind.Dispensing, localId = localId, facilityId = facilityId, rpc = "record_dispensing", txnDate = date,
        photos = photos, summary = summary, sachetsDispensed = dispensed,
        params = buildJsonObject {
            put("p_local_id", localId); put("p_facility_id", facilityId); put("p_dispense_date", date)
            put("p_new_admissions", newAdmissions); put("p_children_seen", childrenSeen)
            put("p_sachets_prescribed", prescribed); put("p_sachets_dispensed", dispensed); put("p_device_id", deviceId)
        },
    )

    fun stockCount(
        localId: String, facilityId: String, date: String, lines: List<LedgerLine>, deviceId: String,
        photos: List<LedgerPhoto>, summary: String,
    ) = LedgerSubmission(
        kind = LedgerKind.StockCount, localId = localId, facilityId = facilityId, rpc = "record_stock_count", txnDate = date,
        lines = lines, photos = photos, summary = summary,
        params = buildJsonObject {
            put("p_local_id", localId); put("p_facility_id", facilityId); put("p_count_date", date)
            put("p_lines", linesJson(lines, countField = true)); put("p_device_id", deviceId)
        },
    )

    fun loss(
        localId: String, facilityId: String, date: String, lossType: String, line: LedgerLine, reason: String,
        deviceId: String, photos: List<LedgerPhoto>, summary: String,
    ) = LedgerSubmission(
        kind = LedgerKind.Loss, localId = localId, facilityId = facilityId, rpc = "record_loss", txnDate = date,
        lines = listOf(line), photos = photos, summary = summary, lossType = lossType,
        params = buildJsonObject {
            put("p_local_id", localId); put("p_facility_id", facilityId); put("p_txn_date", date)
            put("p_txn_type", lossType); put("p_quantity", line.quantity); put("p_reason", reason.trim())
            line.lotId?.let { put("p_lot_id", it) }
            line.lotNo?.let { put("p_lot_no", it.trim()) }
            line.expiryDate?.let { put("p_expiry_date", it) }
            put("p_device_id", deviceId)
        },
    )
}
