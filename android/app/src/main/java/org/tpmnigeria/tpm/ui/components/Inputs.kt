package org.tpmnigeria.tpm.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius

/** Field label + input, matching .field > label / .input in _ds_styles.css. */
@Composable
fun TpmTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    isPassword: Boolean = false,
    enabled: Boolean = true,
    trailingIcon: @Composable (() -> Unit)? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Column(modifier = modifier) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Spacer(Modifier.height(5.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            singleLine = singleLine,
            minLines = minLines,
            placeholder = placeholder?.let { { Text(it, color = TpmColors.TextMuted) } },
            visualTransformation = if (isPassword) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            trailingIcon = trailingIcon,
            shape = RoundedCornerShape(TpmRadius.small),
            colors = tpmInputColors(),
        )
    }
}

@Composable
internal fun tpmInputColors() = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = TpmColors.Surface,
    unfocusedContainerColor = TpmColors.Surface,
    disabledContainerColor = TpmColors.Surface.copy(alpha = 0.5f),
    focusedBorderColor = TpmColors.Accent,
    unfocusedBorderColor = TpmColors.Divider,
    disabledBorderColor = TpmColors.Divider.copy(alpha = 0.45f),
    focusedTextColor = TpmColors.Text,
    unfocusedTextColor = TpmColors.Text,
    cursorColor = TpmColors.Accent,
)

/**
 * Cascading location dropdown (State → LGA → Ward → Settlement → Activity Site): a read-only
 * exposed dropdown that's disabled until [options] is non-empty, per the README's "each is
 * disabled until its parent is chosen" rule. Generic over [T] so it works equally for plain
 * strings (settlement/activity site names) and reference-data rows that carry an id alongside
 * their display name (state/LGA/ward/category) — see [labelFor].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> TpmDropdown(
    label: String,
    selected: T?,
    options: List<T>,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: String = "Select…",
    labelFor: (T) -> String = { it.toString() },
    /** Shown instead of the generic "No data found"/"No options available" when the parent
     *  selection is made but genuinely has zero child records — e.g. "No settlements available
     *  for this Ward." (README §13). */
    emptyLabel: String? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    val isEnabled = enabled
    val noDataLabel = emptyLabel ?: "No data found"
    val displayPlaceholder = if (isEnabled && options.isEmpty()) noDataLabel else placeholder

    Column(modifier = modifier) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TpmColors.TextMuted)
        Spacer(Modifier.height(5.dp))
        ExposedDropdownMenuBox(
            expanded = expanded && isEnabled,
            onExpandedChange = { if (isEnabled) expanded = it },
        ) {
            OutlinedTextField(
                value = selected?.let(labelFor).orEmpty(),
                onValueChange = {},
                readOnly = true,
                enabled = isEnabled,
                placeholder = { Text(displayPlaceholder, color = TpmColors.TextMuted) },
                trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(),
                shape = RoundedCornerShape(TpmRadius.small),
                colors = tpmInputColors(),
            )
            ExposedDropdownMenu(
                expanded = expanded && isEnabled,
                onDismissRequest = { expanded = false },
            ) {
                if (options.isEmpty()) {
                    DropdownMenuItem(
                        text = { Text(emptyLabel ?: "No options available", color = TpmColors.TextMuted) },
                        onClick = { expanded = false },
                        enabled = false
                    )
                } else {
                    options.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(labelFor(option)) },
                            onClick = { onSelect(option); expanded = false },
                        )
                    }
                }
            }
        }
    }
}
