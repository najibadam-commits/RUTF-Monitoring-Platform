package org.tpmnigeria.tpm.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import org.tpmnigeria.tpm.domain.model.DriResponse
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.HistoryEvent
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.IssueStatus
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.domain.model.Verification
import java.time.LocalDate

@Entity(tableName = "issues")
data class IssueEntity(
    @PrimaryKey val id: String,
    val remoteId: String?,
    val remoteCode: String?,
    val state: String,
    val stateId: String?,
    val lga: String,
    val lgaId: String?,
    val ward: String,
    val wardId: String?,
    val settlement: String,
    val settlementId: String?,
    val site: String,
    val siteId: String?,
    val locationOther: String?,
    val category: String,
    val categoryId: String?,
    val severity: Severity,
    val description: String,
    val reporter: String,
    val dateReported: LocalDate,
    val gpsIssue: GpsCapture,
    val status: IssueStatus,
    val assignedDriId: String?,
    val movPhotoPath: String?,
    val selfiePhotoPath: String?,
    val driResponse: DriResponse?,
    val verification: Verification?,
    val history: List<HistoryEvent>,
)

fun IssueEntity.toDomain(): Issue = Issue(
    id = id, remoteId = remoteId, remoteCode = remoteCode,
    state = state, stateId = stateId, lga = lga, lgaId = lgaId, ward = ward, wardId = wardId,
    settlement = settlement, settlementId = settlementId, site = site, siteId = siteId,
    locationOther = locationOther,
    category = category, categoryId = categoryId,
    severity = severity, description = description, reporter = reporter,
    dateReported = dateReported, gpsIssue = gpsIssue, status = status, assignedDriId = assignedDriId,
    movPhotoPath = movPhotoPath, selfiePhotoPath = selfiePhotoPath,
    driResponse = driResponse, verification = verification, history = history,
)

fun Issue.toEntity(): IssueEntity = IssueEntity(
    id = id, remoteId = remoteId, remoteCode = remoteCode,
    state = state, stateId = stateId, lga = lga, lgaId = lgaId, ward = ward, wardId = wardId,
    settlement = settlement, settlementId = settlementId, site = site, siteId = siteId,
    locationOther = locationOther,
    category = category, categoryId = categoryId,
    severity = severity, description = description, reporter = reporter,
    dateReported = dateReported, gpsIssue = gpsIssue, status = status, assignedDriId = assignedDriId,
    movPhotoPath = movPhotoPath, selfiePhotoPath = selfiePhotoPath,
    driResponse = driResponse, verification = verification, history = history,
)
