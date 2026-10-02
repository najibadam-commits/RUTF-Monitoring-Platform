package org.tpmnigeria.tpm.ui.wizard.verification

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

const val FINAL_VERIFY_STEP_COUNT = 5
val FINAL_VERIFY_STEP_LABELS = listOf("Look Up Finding", "Confirm Resolution", "Date & Location", "Evidence", "Review")

/** README §7 Final Verification — 5-step wizard. Mirrors fvValidArr's per-step validation. */
class FinalVerifyWizardViewModel(
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

    /** null = undecided, true = Yes (resolved), false = No (not resolved). */
    var confirmed by mutableStateOf<Boolean?>(null)
    var comment by mutableStateOf("")
    var date by mutableStateOf(LocalDate.now())
    var gps by mutableStateOf<GpsCapture?>(null)
    var selfiePhotoPath by mutableStateOf<String?>(null)
    var movPhotoPath by mutableStateOf<String?>(null)

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
            repository.findIssueForVerification(id).fold(
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
        2 -> confirmed != null && comment.isNotBlank()
        3 -> gps != null
        4 -> selfiePhotoPath != null && movPhotoPath != null
        else -> true
    }

    val warningText: String get() = when (step) {
        1 -> "Find or select a finding to continue."
        2 -> "Confirm resolution status and provide a comment."
        3 -> "Capture GPS location for this verification."
        4 -> "Capture both your selfie and the MOV photo."
        else -> ""
    }

    fun next() {
        if (isCurrentStepValid) step = (step + 1).coerceAtMost(FINAL_VERIFY_STEP_COUNT)
    }

    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(): Issue? {
        val issue = foundIssue ?: return null
        if (!isCurrentStepValid) return null
        val verifierName = session.currentUser.value?.name ?: run {
            submitError = "You're signed out — please log in again."
            return null
        }
        isSubmitting = true
        submitError = null
        return try {
            repository.submitVerification(
                issueId = issue.id, confirmed = confirmed == true, comment = comment, date = date,
                gps = gps!!, selfiePhotoPath = selfiePhotoPath!!, movPhotoPath = movPhotoPath,
                verifierName = verifierName,
            )
        } catch (e: Exception) {
            submitError = "Couldn't submit — ${e.message ?: "please try again"}."
            null
        } finally {
            isSubmitting = false
        }
    }
}
