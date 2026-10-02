package org.tpmnigeria.tpm.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * Local-first mirror of one row the app will eventually push to `field_monitor_attendance` (web
 * migration 0037 — see DECISIONS.md #24). [localId] is `"att-$fieldMonitorId-$attendanceDate"` —
 * deterministic, not a random UUID, so a second capture attempt for the same Field Monitor+day
 * naturally collides on the primary key instead of needing a separate lookup to enforce it (the
 * real, unconditional duplicate-prevention boundary is still the server's own
 * `unique(field_monitor_id, attendance_date)` constraint; this just makes the common "device never
 * left airplane mode" case behave the same way without a round-trip).
 *
 * [remoteId] is null until [org.tpmnigeria.tpm.sync.SupabaseSyncApiService] successfully pushes
 * it — mirrors [IssueEntity.remoteId]'s convention exactly.
 */
@Entity(tableName = "attendance_records")
data class AttendanceEntity(
    @PrimaryKey val localId: String,
    val remoteId: String?,
    val fieldMonitorId: String,
    val attendanceDate: String, // yyyy-MM-dd
    val capturedAtMillis: Long,
    val lat: Double,
    val lng: Double,
    val gpsAccuracyM: Int,
    val selfiePhotoPath: String,
    val assignmentLocationPhotoPath: String,
    val deviceId: String,
)

@Dao
interface AttendanceDao {
    @Query("SELECT * FROM attendance_records WHERE fieldMonitorId = :fieldMonitorId AND attendanceDate = :attendanceDate LIMIT 1")
    suspend fun findForFieldMonitorAndDate(fieldMonitorId: String, attendanceDate: String): AttendanceEntity?

    @Query("SELECT * FROM attendance_records WHERE localId = :localId")
    suspend fun getById(localId: String): AttendanceEntity?

    @Insert
    suspend fun insert(entity: AttendanceEntity)

    @Query("UPDATE attendance_records SET remoteId = :remoteId WHERE localId = :localId")
    suspend fun setRemoteId(localId: String, remoteId: String)
}
