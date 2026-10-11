package org.tpmnigeria.tpm.ui.wizard.common

import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.width
import androidx.compose.ui.draw.shadow
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.theme.TpmGradients
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/**
 * Shared chrome for all three wizards (README §5/§6/§7): progress bar + step label at top,
 * scrollable step content, Continue/Submit button pinned to the bottom that's disabled until
 * [isStepValid] — with the required inline warning text explaining what's missing. This is
 * compulsory validation: there is no way to tap through with [isStepValid] false, since the
 * button itself is non-interactive in that state (see TpmButton's disabled handling).
 */
@Composable
fun WizardScaffold(
    stepIndex: Int,
    totalSteps: Int,
    stepLabel: String,
    isStepValid: Boolean,
    warningText: String,
    onContinue: () -> Unit,
    continueLabel: String,
    modifier: Modifier = Modifier,
    isSubmitting: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = TpmSpacing.space4, vertical = TpmSpacing.space2)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(TpmColors.Accent100),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(stepIndex.toFloat() / totalSteps.toFloat())
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(TpmGradients.Button),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Step $stepIndex of $totalSteps",
                    style = MaterialTheme.typography.labelMedium,
                    color = TpmColors.Accent700,
                    modifier = Modifier.background(TpmColors.Accent100, RoundedCornerShape(TpmRadius.pill)).padding(horizontal = 10.dp, vertical = 3.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(stepLabel, style = MaterialTheme.typography.titleSmall, color = TpmColors.Text)
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = TpmSpacing.space4),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3), content = content)
            }
            item { Spacer(Modifier.height(TpmSpacing.space4)) }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(12.dp, RoundedCornerShape(topStart = TpmRadius.large, topEnd = TpmRadius.large), ambientColor = TpmColors.Blue.copy(alpha = 0.18f), spotColor = TpmColors.Blue.copy(alpha = 0.18f))
                .background(TpmColors.White, RoundedCornerShape(topStart = TpmRadius.large, topEnd = TpmRadius.large))
                .padding(TpmSpacing.space4),
        ) {
            TpmButton(
                text = if (isSubmitting) "Submitting…" else continueLabel,
                onClick = onContinue,
                enabled = isStepValid && !isSubmitting,
                blueprint = true,
                fullWidth = true,
            )
            if (!isStepValid && warningText.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    warningText,
                    style = MaterialTheme.typography.bodySmall,
                    color = TpmColors.Warning,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
