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
import org.tpmnigeria.tpm.data.remote.Supabase

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

    // Weekly OTP Site Report (web migration 0126; DECISIONS R149). Calculated live on the server.
    suspend fun reportOpen(weekStart: String) = call("otp_report_open", buildJsonObject { put("p_week_start", weekStart) })
    suspend fun reportSaveComments(reportId: String, comments: JsonObject) =
        call("otp_report_save_comments", buildJsonObject { put("p_report_id", reportId); put("p_comments", comments) })
    suspend fun reportSubmit(reportId: String, comments: JsonObject, amendmentReason: String?) = call("otp_report_submit", buildJsonObject {
        put("p_report_id", reportId); put("p_comments", comments); put("p_confirm_reviewed", true)
        if (!amendmentReason.isNullOrBlank()) put("p_amendment_reason", amendmentReason)
    })
    suspend fun reportStartAmendment(reportId: String) = call("otp_report_start_amendment", buildJsonObject { put("p_report_id", reportId) })
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
