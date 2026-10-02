package org.tpmnigeria.tpm.data.local

import androidx.room.TypeConverter
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.tpmnigeria.tpm.domain.model.DriResponse
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.HistoryEvent
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.SubmissionType
import org.tpmnigeria.tpm.domain.model.SyncStatus
import org.tpmnigeria.tpm.domain.model.UserRole
import org.tpmnigeria.tpm.domain.model.Verification
import java.time.LocalDate

/**
 * Room type converters for the nested parts of Issue (gpsIssue, driResponse, verification,
 * history) — stored as JSON text columns rather than joined child tables. Each issue owns
 * exactly one of each (or a small fixed-shape list for history), so a join adds relational
 * ceremony without a real query benefit here; this keeps IssueDao's queries simple while still
 * letting top-level columns (status, severity, dateReported, etc.) stay natively queryable/sortable.
 */
class Converters {
    private val json = Json { ignoreUnknownKeys = true }

    @TypeConverter
    fun fromLocalDate(date: LocalDate): String = date.toString()

    @TypeConverter
    fun toLocalDate(value: String): LocalDate = LocalDate.parse(value)

    @TypeConverter
    fun fromSeverity(severity: Severity): String = severity.name

    @TypeConverter
    fun toSeverity(value: String): Severity = Severity.valueOf(value)

    @TypeConverter
    fun fromIssueStatus(status: IssueStatus): String = status.name

    @TypeConverter
    fun toIssueStatus(value: String): IssueStatus = IssueStatus.valueOf(value)

    @TypeConverter
    fun fromGpsCapture(gps: GpsCapture): String = json.encodeToString(gps)

    @TypeConverter
    fun toGpsCapture(value: String): GpsCapture = json.decodeFromString(value)

    @TypeConverter
    fun fromDriResponse(response: DriResponse?): String? = response?.let { json.encodeToString(it) }

    @TypeConverter
    fun toDriResponse(value: String?): DriResponse? = value?.let { json.decodeFromString(it) }

    @TypeConverter
    fun fromVerification(verification: Verification?): String? = verification?.let { json.encodeToString(it) }

    @TypeConverter
    fun toVerification(value: String?): Verification? = value?.let { json.decodeFromString(it) }

    @TypeConverter
    fun fromHistory(history: List<HistoryEvent>): String = json.encodeToString(history)

    @TypeConverter
    fun toHistory(value: String): List<HistoryEvent> = json.decodeFromString(value)

    @TypeConverter
    fun fromUserRole(role: UserRole): String = role.name

    @TypeConverter
    fun toUserRole(value: String): UserRole = UserRole.valueOf(value)

    @TypeConverter
    fun fromSubmissionType(type: SubmissionType): String = type.name

    @TypeConverter
    fun toSubmissionType(value: String): SubmissionType = SubmissionType.valueOf(value)

    @TypeConverter
    fun fromSyncStatus(status: SyncStatus): String = status.name

    @TypeConverter
    fun toSyncStatus(value: String): SyncStatus = SyncStatus.valueOf(value)
}
