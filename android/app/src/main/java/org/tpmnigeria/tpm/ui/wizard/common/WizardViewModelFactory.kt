package org.tpmnigeria.tpm.ui.wizard.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory

/** No DI framework in this app (see TpmApplication's kdoc) — this is the one bit of boilerplate
 *  that saves writing a dedicated Factory class per wizard ViewModel. */
@Composable
inline fun <reified VM : ViewModel> rememberWizardViewModel(crossinline create: () -> VM): VM {
    val factory = remember {
        viewModelFactory { initializer { create() } }
    }
    return viewModel(factory = factory)
}
