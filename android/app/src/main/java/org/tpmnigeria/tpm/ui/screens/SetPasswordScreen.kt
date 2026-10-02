package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

private const val MIN_PASSWORD_LENGTH = 8

/**
 * Shown when AppSession.passwordRecoveryPending is true — after the app handles an invitation or
 * "forgot password" email's deep link (see MainActivity/AppSession.handleAuthDeepLink). Matches
 * the flow from the production-stabilization audit's Section 3/4: set a new password, then land
 * back on Login to sign in normally with it (AppSession.completePasswordReset signs the recovery
 * session back out on success, by design — see its kdoc).
 */
@Composable
fun SetPasswordScreen(session: AppSession) {
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmVisible by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }
    var success by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(horizontal = TpmSpacing.space6),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        if (success) {
            Text("Password updated successfully.", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Spacer(Modifier.height(TpmSpacing.space2))
            Text(
                "Your account is now ready. Sign in with your new password.",
                style = MaterialTheme.typography.bodyMedium,
                color = TpmColors.TextMuted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(TpmSpacing.space6))
            TpmButton(
                text = "Go to Login",
                onClick = { scope.launch { session.cancelPasswordRecovery() } },
                blueprint = true,
                fullWidth = true,
            )
        } else {
            Text("Set a password", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Spacer(Modifier.height(TpmSpacing.space2))
            Text(
                "Choose a password for your account to finish setting it up.",
                style = MaterialTheme.typography.bodyMedium,
                color = TpmColors.TextMuted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(TpmSpacing.space6))

            TpmTextField(
                label = "New Password",
                value = password,
                onValueChange = { password = it; error = null },
                placeholder = "••••••••",
                isPassword = !passwordVisible,
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(
                            if (passwordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (passwordVisible) "Hide password" else "Show password",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(TpmSpacing.space3))
            TpmTextField(
                label = "Confirm Password",
                value = confirmPassword,
                onValueChange = { confirmPassword = it; error = null },
                placeholder = "••••••••",
                isPassword = !confirmVisible,
                trailingIcon = {
                    IconButton(onClick = { confirmVisible = !confirmVisible }) {
                        Icon(
                            if (confirmVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (confirmVisible) "Hide password" else "Show password",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(TpmSpacing.space2))
            Text(
                "At least $MIN_PASSWORD_LENGTH characters.",
                style = MaterialTheme.typography.bodySmall,
                color = TpmColors.TextMuted,
            )

            if (error != null) {
                Spacer(Modifier.height(TpmSpacing.space2))
                Text(error.orEmpty(), color = TpmColors.Accent800, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(TpmSpacing.space4))
            TpmButton(
                text = if (isSubmitting) "Setting password…" else "Set Password",
                onClick = {
                    when {
                        password.isBlank() || confirmPassword.isBlank() -> error = "Enter and confirm your new password."
                        password.length < MIN_PASSWORD_LENGTH -> error = "Password must be at least $MIN_PASSWORD_LENGTH characters."
                        password != confirmPassword -> error = "Passwords do not match."
                        else -> {
                            isSubmitting = true
                            error = null
                            scope.launch {
                                session.completePasswordReset(password)
                                    .onSuccess { success = true }
                                    .onFailure { e -> error = e.message ?: "Could not set password — please try again." }
                                isSubmitting = false
                            }
                        }
                    }
                },
                enabled = !isSubmitting,
                blueprint = true,
                fullWidth = true,
            )
            if (isSubmitting) {
                Spacer(Modifier.height(TpmSpacing.space2))
                CircularProgressIndicator(modifier = Modifier.size(20.dp))
            }

            Spacer(Modifier.height(TpmSpacing.space3))
            TpmButton(
                text = "Cancel",
                onClick = { scope.launch { session.cancelPasswordRecovery() } },
                variant = TpmButtonVariant.Ghost,
                enabled = !isSubmitting,
            )
        }

        Spacer(Modifier.weight(1.4f))
    }
}
