package org.tpmnigeria.tpm.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import org.tpmnigeria.tpm.domain.model.SubmissionType
import org.tpmnigeria.tpm.domain.model.SyncQueueItem
import org.tpmnigeria.tpm.domain.model.SyncStatus

@Entity(tableName = "sync_queue")
data class SyncQueueEntity(
    @PrimaryKey val localId: String,
    val issueId: String,
    val submissionType: SubmissionType,
    val status: SyncStatus,
    val timestampMillis: Long,
    val payloadJson: String,
    val retryCount: Int = 0,
)

fun SyncQueueEntity.toDomain(): SyncQueueItem = SyncQueueItem(
    localId = localId, issueId = issueId, submissionType = submissionType,
    status = status, timestampMillis = timestampMillis, payloadJson = payloadJson,
    retryCount = retryCount,
)

fun SyncQueueItem.toEntity(): SyncQueueEntity = SyncQueueEntity(
    localId = localId, issueId = issueId, submissionType = submissionType,
    status = status, timestampMillis = timestampMillis, payloadJson = payloadJson,
    retryCount = retryCount,
)
