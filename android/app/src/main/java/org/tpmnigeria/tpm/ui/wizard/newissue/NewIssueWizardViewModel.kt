package org.tpmnigeria.tpm.ui.wizard.newissue

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.data.AppRepository
import org.tpmnigeria.tpm.data.ReferenceRepository
import org.tpmnigeria.tpm.data.local.ActivitySiteRefEntity
import org.tpmnigeria.tpm.data.local.CategoryRefEntity
import org.tpmnigeria.tpm.data.local.LgaRefEntity
import org.tpmnigeria.tpm.data.local.SettlementRefEntity
import org.tpmnigeria.tpm.data.local.StateRefEntity
import org.tpmnigeria.tpm.data.local.WardRefEntity
import org.tpmnigeria.tpm.domain.model.GpsCapture
import org.tpmnigeria.tpm.domain.model.Issue
import org.tpmnigeria.tpm.domain.model.Severity
import org.tpmnigeria.tpm.session.AppSession
import java.time.LocalDate

const val NEW_ISSUE_STEP_COUNT = 6
val NEW_ISSUE_STEP_LABELS = listOf("Location", "Finding Details", "GPS Capture", "MOV Photo", "Selfie", "Review")

/**
 * One entry in the Location step's merged picker: Settlements and Activity Sites for the selected
 * Ward shown together in a single list (rather than two separate required dropdowns), plus a
 * trailing [Other] choice for field staff to type a name manually when the real place isn't in
 * the preloaded reference list yet. Settlements and Activity Sites stay distinct tables/FKs on the
 * server (see DECISIONS.md #8) — this is a UI-layer merge only, not a data-model merge: whichever
 * variant is picked determines which FK (or neither, for [Other]) the submitted issue carries.
 */
sealed class LocationOption {
    abstract val label: String

    data class Settlement(val entity: SettlementRefEntity) : LocationOption() {
        override val label get() = "${entity.name} · Settlement"
    }

    data class Site(val entity: ActivitySiteRefEntity) : LocationOption() {
        override val label get() = "${entity.name} · Activity Site"
    }

    object Other : LocationOption() {
        override val label = "Other — not listed (type manually)"
    }
}

/**
 * README §5 Register New Issue — 6-step wizard state + the compulsory per-step validation rule:
 * Continue/Submit is disabled until [isCurrentStepValid] for the active step. Location/category
 * selections carry both the real Supabase row (id, needed for the FK columns on `issues`) and
 * its display name (needed for the denormalized text columns and the wizard's own UI) — see
 * ReferenceRepository for where the underlying pick-lists come from.
 */
class NewIssueWizardViewModel(
    private val repository: AppRepository,
    private val referenceRepository: ReferenceRepository,
    private val session: AppSession,
) : ViewModel() {
    var step by mutableStateOf(1)
        private set

    var selectedState by mutableStateOf<StateRefEntity?>(null)
        private set
    var selectedLga by mutableStateOf<LgaRefEntity?>(null)
        private set
    var selectedWard by mutableStateOf<WardRefEntity?>(null)
        private set
    var selectedLocation by mutableStateOf<LocationOption?>(null)
        private set
    /** Only meaningful when [selectedLocation] is [LocationOption.Other]. */
    var otherLocationText by mutableStateOf("")

    var selectedCategory by mutableStateOf<CategoryRefEntity?>(null)
    var severity by mutableStateOf<Severity?>(null)
    var description by mutableStateOf("")
    var date by mutableStateOf(LocalDate.now())

    var gps by mutableStateOf<GpsCapture?>(null)
    var movPhotoPath by mutableStateOf<String?>(null)
    var selfiePhotoPath by mutableStateOf<String?>(null)

    var isSubmitting by mutableStateOf(false)
        private set
    var submitError by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            // Force a refresh if states are empty (e.g. first run or after DB clear)
            referenceRepository.refreshCoreReferenceData()
        }
    }

    fun onStateChange(v: StateRefEntity) {
        selectedState = v; selectedLga = null; selectedWard = null; selectedLocation = null; otherLocationText = ""
    }

    fun onLgaChange(v: LgaRefEntity) {
        selectedLga = v; selectedWard = null; selectedLocation = null; otherLocationText = ""
        viewModelScope.launch {
            try { referenceRepository.ensureWardsLoaded(v.id) } catch (e: Exception) { /* Silently handled in repo */ }
        }
    }

    /** Settlement and Activity Site are both scoped to the Ward directly — independent siblings, not chained through each other. */
    fun onWardChange(v: WardRefEntity) {
        selectedWard = v; selectedLocation = null; otherLocationText = ""
        viewModelScope.launch {
            try { referenceRepository.ensureSettlementsLoaded(v.id) } catch (e: Exception) { /* Silently handled in repo */ }
        }
        viewModelScope.launch {
            try { referenceRepository.ensureActivitySitesLoaded(v.id) } catch (e: Exception) { /* Silently handled in repo */ }
        }
    }

    fun onLocationChange(v: LocationOption) {
        selectedLocation = v
        if (v != LocationOption.Other) otherLocationText = ""
    }

    val isCurrentStepValid: Boolean get() = when (step) {
        1 -> selectedState != null && selectedLga != null && selectedWard != null && when (selectedLocation) {
            null -> false
            LocationOption.Other -> otherLocationText.isNotBlank()
            else -> true
        }
        2 -> selectedCategory != null && severity != null && description.isNotBlank()
        3 -> gps != null
        4 -> movPhotoPath != null
        5 -> selfiePhotoPath != null
        else -> true
    }

    val warningText: String get() = when (step) {
        1 -> "Select state, LGA, ward and a settlement or activity site — or choose \"Other\" and type the name."
        2 -> "Select sector, severity and enter a description."
        3 -> "Capture GPS location for an accurate record."
        4 -> "Capture the MOV photo as evidence."
        5 -> "Capture your selfie to confirm your presence."
        else -> ""
    }

    fun next() {
        if (isCurrentStepValid) step = (step + 1).coerceAtMost(NEW_ISSUE_STEP_COUNT)
    }

    /** Returns true if it moved back a step; false if already at step 1 (caller should exit). */
    fun back(): Boolean = if (step > 1) { step--; true } else false

    suspend fun submit(): Issue? {
        if (!isCurrentStepValid) return null
        val reporterName = session.currentUser.value?.name ?: run {
            submitError = "You're signed out — please log in again."
            return null
        }
        val state = selectedState!!
        val lga = selectedLga!!
        val ward = selectedWard!!
        val location = selectedLocation!!
        isSubmitting = true
        submitError = null
        return try {
            repository.submitNewIssue(
                stateId = state.id, stateName = state.name,
                lgaId = lga.id, lgaName = lga.name, lgaAbbr = lga.abbr,
                wardId = ward.id, wardName = ward.name, wardAbbr = ward.abbr,
                settlementId = (location as? LocationOption.Settlement)?.entity?.id,
                settlement = (location as? LocationOption.Settlement)?.entity?.name,
                siteId = (location as? LocationOption.Site)?.entity?.id,
                site = (location as? LocationOption.Site)?.entity?.name,
                locationOther = if (location == LocationOption.Other) otherLocationText.trim() else null,
                categoryId = selectedCategory!!.id, category = selectedCategory!!.name, categoryAbbr = selectedCategory!!.abbr,
                severity = severity!!, description = description, date = date,
                gps = gps!!, movPhotoPath = movPhotoPath!!, selfiePhotoPath = selfiePhotoPath!!,
                reporterName = reporterName,
            )
        } catch (e: Exception) {
            submitError = "Couldn't submit — ${e.message ?: "please try again"}."
            null
        } finally {
            isSubmitting = false
        }
    }
}
