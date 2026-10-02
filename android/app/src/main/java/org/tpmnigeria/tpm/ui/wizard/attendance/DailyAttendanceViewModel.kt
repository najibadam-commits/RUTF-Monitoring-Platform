package org.tpmnigeria.tpm.ui.wizard.attendance

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.data.local.AttendanceEntity
import org.tpmnigeria.tpm.domain.androidDeviceId
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.session.AppSession
import java.time.LocalDate

const val ATTENDANCE_STEP_COUNT = 4
val ATTENDANCE_STEP_LABELS = listOf("Selfie", "Assignment Location", "GPS Location", "Review")

/**
 * Items 9-15 — Daily Attendance capture, Field Monitor only. A 4-step mini-wizard, same shared
 * WizardScaffold/PhotoCaptureStep/GpsCaptureStep chrome as the other three wizards (see
 * DECISIONS.md #24 in the web project: "use the existing synchronization mechanism/UI patterns
 * wherever possible" applies just as much to the UI layer as the sync layer). Only one record per
 * Field Monitor per day is allowed — see [alreadySubmittedToday].
 */
class DailyAttendanceViewModel(
    private val repository: AppRepository,
    private val session: AppSession,
    private val appContext: Context,
) : ViewModel() {
    val today: LocalDate = LocalDate.now()

    var isChecking by mutableStateOf(true)
        private set

    /** Non-null once the duplicate check finds an existing record for today — the screen shows a
     *  read-only "already submitted" state instead of the capture wizard in that case. This is
     *  only the fast, offline-capable mirror of the real boundary: the server's own
     *  `unique(field_monitor_id, attendance_date)` constraint (migration 0037). */
    var alreadySubmittedToday by mutableStateOf<AttendanceEntity?>(null)
        private set

    var step by mutableStateOf(1)
        private set

    var selfiePhotoPath by mutableStateOf<String?>(null)
    var locationPhotoPath by mutableStateOf<String?>(null)
    var gps by mutableStateOf<GpsCapture?>(null)

    var isSubmitting by mutableStateOf(false)
        private set
    var submitError by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            val fieldMonitorId = session.currentUser.value?.id
            alreadySubmittedToday = fieldMonitorId?.let { repository.findTodaysAttendance(it, today) }
            isChecking = false
        }
    }

    val isCurrentStepValid: Boolean get() = when (step) {
        1 -> selfiePhotoPath != null
        2 -> locationPhotoPath != null
        3 -> gps != null
        else -> true
    }

    val warningText: String get() = when (step) {
        1 -> "Capture your selfie to continue."
        2 -> "Capture a photo of your assignment location to continue."
        3 -> "Capture your GPS location to continue."
        else -> ""
    }

    fun next() {
        if (isCurrentStepValid) step = (step + 1).coerceAtMost(ATTENDANCE_STEP_COUNT)
    }

    fun back(): Boolean = if (step > 1) { step--; true } else false

    /** Not silently submitted if incomplete — every field this asserts non-null on is also what
     *  gates the Submit button via [isCurrentStepValid] on every prior step (WizardScaffold
     *  disables Continue/Submit until the current step is valid), so reaching here with a null
     *  should be unreachable; this is a defensive backstop, not the real gate. */
    suspend fun submit(): AttendanceEntity? {
        val selfie = selfiePhotoPath ?: return null
        val locationPhoto = locationPhotoPath ?: return null
        val fix = gps ?: return null
        val fieldMonitorId = session.currentUser.value?.id ?: run {
            submitError = "You're signed out — please log in again."
            return null
        }
        isSubmitting = true
        submitError = null
        return try {
            repository.submitAttendance(
                fieldMonitorId = fieldMonitorId,
                attendanceDate = today,
                gps = fix,
                selfiePhotoPath = selfie,
                assignmentLocationPhotoPath = locationPhoto,
                deviceId = androidDeviceId(appContext),
            )
        } catch (e: Exception) {
            submitError = "Couldn't submit — ${e.message ?: "please try again"}."
            null
        } finally {
            isSubmitting = false
        }
    }
}
