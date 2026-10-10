package org.tpmnigeria.tpm.data

import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import io.github.jan.supabase.storage.storage
import org.tpmnigeria.tpm.data.remote.Supabase
import java.io.File
import java.util.UUID

/** Private bucket for the photos of RUTF given at OTP visits (web migration 0128). */
const val OTP_RUTF_EVIDENCE_BUCKET = "otp-rutf-evidence"

/**
 * The Digital OTP Admission Card (RUTF DECISIONS R142–R145): every call goes to the database's
 * checked functions (web migration 0124), which decide who may do what. Only an OTP Officer at an
 * OTP site gets an answer, and a child's record only at the child's own site.
 *
 * Privacy (the programme's rule): a child's and caregiver's details are fetched only when the OTP
 * Officer enters the Child ID, are shown on screen and are NEVER stored on the phone (no Room
 * table, no cache, no sync queue). Everything here therefore needs a connection; registration does
 * anyway, because the server issues the Child ID so two phones can never issue the same one.
 */
class OtpRepository {
    private val postgrest get() = Supabase.client.postgrest
    private val json = Json { ignoreUnknownKeys = true }

    private suspend fun call(fn: String, params: JsonObject): OtpResult = try {
        val result = postgrest.rpc(fn, params)
        // Functions return an object, a single value (an id) or nothing.
        val body = result.data.trim()
        OtpResult.Ok(
            when {
                body.isEmpty() || body == "null" -> JsonObject(emptyMap())
                body.startsWith("{") -> json.parseToJsonElement(body).jsonObject
                else -> JsonObject(mapOf("value" to json.parseToJsonElement(body)))
            },
        )
    } catch (e: RestException) {
        OtpResult.Error(e.error)
    } catch (e: Exception) {
        OtpResult.Error("No connection. The OTP Admission Card needs a signal: try again when you're online.")
    }

    private fun p(body: JsonObject) = buildJsonObject { put("p", body) }

    suspend fun screen(body: JsonObject) = call("otp_screen", p(body))
    suspend fun register(body: JsonObject) = call("otp_register_child", p(body))
    suspend fun lookup(childCode: String) = call("otp_child_lookup", buildJsonObject { put("p_child_code", childCode.trim().uppercase()) })
    suspend fun recordVisit(body: JsonObject) = call("otp_record_visit", p(body))
    suspend fun recordMedication(body: JsonObject) = call("otp_record_medication", p(body))
    suspend fun recordOutcome(body: JsonObject) = call("otp_record_outcome", p(body))
    suspend fun ration(weightKg: Double) = call("otp_ration", buildJsonObject { put("p_weight_kg", weightKg) })

    // Follow-up (web migration 0128; DECISIONS R150–R153): the visits list (Child IDs only), the
    // next visit, referrals and the photo of the RUTF given.
    suspend fun myVisits() = call("otp_my_visits", buildJsonObject { })
    /** Active OTP sites in the officer's state (web 0129), as {"value": [{id, name, lga}]}. */
    suspend fun transferDestinations() = call("otp_transfer_destinations", buildJsonObject { })
    suspend fun transfer(childCode: String, toFacilityId: String, reason: String) = call("otp_transfer_child", buildJsonObject {
        put("p_child_code", childCode); put("p_to_facility", toFacilityId); put("p_reason", reason)
    })
    suspend fun readmit(body: JsonObject) = call("otp_readmit_child", p(body))
    suspend fun reschedule(body: JsonObject) = call("otp_reschedule_visit", p(body))
    suspend fun refer(body: JsonObject) = call("otp_refer_child", p(body))
    suspend fun updateReferral(referralId: String, status: String, note: String?) = call("otp_update_referral", buildJsonObject {
        put("p_referral_id", referralId); put("p_status", status); put("p_note", note.orEmpty())
    })

    /**
     * Uploads the photo of the RUTF given to the private bucket under the visit's folder
     * ({site}/{visit}/), attaches it to the visit (which completes it) and deletes the file from
     * the phone. The officer has confirmed that no child or caregiver is in the photo.
     */
    suspend fun uploadRutfPhoto(visitId: String, folder: String, localPath: String): OtpResult {
        val file = File(localPath)
        if (!file.exists()) return OtpResult.Error("The photo file is missing: take it again.")
        val path = folder.trimEnd('/') + "/" + UUID.randomUUID() + ".jpg"
        return try {
            Supabase.client.storage.from(OTP_RUTF_EVIDENCE_BUCKET).upload(path, file.readBytes()) { upsert = false }
            call("otp_attach_visit_photo", buildJsonObject {
                put("p_visit_id", visitId); put("p_storage_path", path); put("p_no_people_confirmed", true)
            }).also { if (it is OtpResult.Ok) file.delete() }
        } catch (e: RestException) {
            OtpResult.Error(e.error)
        } catch (e: Exception) {
            OtpResult.Error("No connection. The photo is still on this screen: try again when you're online.")
        }
    }

    // Weekly OTP Site Report (web migration 0126; DECISIONS R149). Calculated live on the server.
    suspend fun reportOpen(weekStart: String) = call("otp_report_open", buildJsonObject { put("p_week_start", weekStart) })
    suspend fun reportSaveComments(reportId: String, comments: JsonObject) =
        call("otp_report_save_comments", buildJsonObject { put("p_report_id", reportId); put("p_comments", comments) })
    suspend fun reportSubmit(reportId: String, comments: JsonObject, amendmentReason: String?) = call("otp_report_submit", buildJsonObject {
        put("p_report_id", reportId); put("p_comments", comments); put("p_confirm_reviewed", true)
        if (!amendmentReason.isNullOrBlank()) put("p_amendment_reason", amendmentReason)
    })
    suspend fun reportStartAmendment(reportId: String) = call("otp_report_start_amendment", buildJsonObject { put("p_report_id", reportId) })
    /** Corrects one figure of the draft with a reason (value null removes the correction). */
    suspend fun reportAdjust(reportId: String, path: String, value: Double?, reason: String) = call("otp_report_adjust", buildJsonObject {
        put("p_report_id", reportId); put("p_path", path); put("p_value", value); put("p_reason", reason)
    })
    suspend fun recordMnpStock(body: JsonObject) = call("otp_record_mnp_stock", p(body))
    suspend fun recordMnpDoses(body: JsonObject) = call("otp_record_mnp_doses", p(body))
    suspend fun recordIycfSession(body: JsonObject) = call("otp_record_iycf_session", p(body))
}

sealed interface OtpResult {
    data class Ok(val data: JsonObject) : OtpResult
    data class Error(val message: String) : OtpResult
}

// Small readers for the functions' JSON answers.
fun JsonObject.str(key: String): String? = when (val v = this[key]) {
    null, is JsonNull -> null
    is JsonPrimitive -> v.contentOrNull
    else -> v.toString()
}
fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
fun JsonObject.arr(key: String): JsonArray = (this[key] as? JsonArray) ?: JsonArray(emptyList())
fun JsonObject.bool(key: String): Boolean = str(key) == "true"
fun JsonArray.strings(): List<String> = mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
fun JsonArray.objects(): List<JsonObject> = mapNotNull { it as? JsonObject }
