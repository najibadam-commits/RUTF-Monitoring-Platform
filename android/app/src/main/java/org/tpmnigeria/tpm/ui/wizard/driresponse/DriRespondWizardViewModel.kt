package org.tpmnigeria.tpm.ui.wizard.driresponse

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.session.AppSession
import java.time.LocalDate

const val DRI_RESPOND_STEP_COUNT = 6
val DRI_RESPOND_STEP_LABELS = listOf("Look Up Finding", "Response", "Date & Location", "Status", "Evidence", "Review")

/** README §6 DRI Response — 6-step wizard. Mirrors driValidArr's per-step validation. */
class DriRespondWizardViewModel(
    private val repository: AppRepository,
    private val session: AppSession,
    initialIssueId: String?,
) : ViewModel() {
    var step by mutableStateOf(1)
        private set

    var lookupId by mutableStateOf(initialIssueId.orEmpty())
    var lookupError by mutableStateOf<String?>(null)
        private set
    var foundIssue by mutableStateOf<Issue?>(null)
        private set

    var designation by mutableStateOf("")
    var action by mutableStateOf("")
    var date by mutableStateOf(LocalDate.now())
    var gps by mutableStateOf<GpsCapture?>(null)
    /** null = undecided, false = Ongoing, true = Resolved. */
    var resolved by mutableStateOf<Boolean?>(null)
    var movPhotoPath by mutableStateOf<String?>(null)
    var selfiePhotoPath by mutableStateOf<String?>(null)

    var isSubmitting by mutableStateOf(false)
        private set
    var submitError by mutableStateOf<String?>(null)
        private set

    init {
        if (!initialIssueId.isNullOrBlank()) {
            search(initialIssueId) { if (it) step = 2 }
        }
    }

    fun search(idOverride: String? = null, onResult: (found: Boolean) -> Unit = {}) {
        val id = idOverride ?: lookupId
        viewModelScope.launch {
            repository.findIssueForDriLookup(id).fold(
                onSuccess = { issue -> foundIssue = issue; lookupId = issue.id; lookupError = null; onResult(true) },
                onFailure = { e -> foundIssue = null; lookupError = e.message; onResult(false) },
            )
        }
    }

    fun pickIssue(issue: Issue) {
        foundIssue = issue
        lookupId = issue.id
        lookupError = null
        step = 2
    }

    val isCurrentStepValid: Boolean get() = when (step) {
        1 -> foundIssue != null
        2 -> designation.isNotBlank() && action.isNotBlank()
        3 -> gps != null
        4 -> resolved != null
        5 -> movPhotoPath != null && selfiePhotoPath != null
        else -> true
    }

    val warningText: String get() = when (step) {
        1 -> "Find or select a finding to continue."
        2 -> "Select your designation and describe the action taken."
        3 -> "Capture GPS location for this action."
        4 -> "Select the current status of the finding."
        5 -> "Capture both the MOV photo and your selfie."
        else -> ""
    }

    fun next() {
        if (isCurrentStepValid) step = (step + 1).coerceAtMost(DRI_RESPOND_STEP_COUNT)
    }

    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(): Issue? {
        val issue = foundIssue ?: return null
        if (!isCurrentStepValid) return null
        val user = session.currentUser.value ?: run {
            submitError = "You're signed out — please log in again."
            return null
        }
        isSubmitting = true
        submitError = null
        return try {
            repository.submitDriResponse(
                issueId = issue.id, driId = user.id, driName = user.name, designation = designation,
                action = action, date = date, gps = gps!!, resolved = resolved == true,
                movPhotoPath = movPhotoPath!!, selfiePhotoPath = selfiePhotoPath!!,
            )
        } catch (e: Exception) {
            submitError = "Couldn't submit — ${e.message ?: "please try again"}."
            null
        } finally {
            isSubmitting = false
        }
    }
}
