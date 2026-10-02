package org.tpmnigeria.tpm.ui.wizard.common

/** Which shared capture modal (if any) a wizard step currently has open. */
sealed interface WizardModal {
    data object Gps : WizardModal
    data object Voice : WizardModal
    data class Camera(val useFrontCamera: Boolean, val label: String) : WizardModal
}
