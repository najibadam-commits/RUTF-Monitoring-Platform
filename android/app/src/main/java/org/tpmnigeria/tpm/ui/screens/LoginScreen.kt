package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.R
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/**
 * README §1 Login, now backed by real Supabase Auth (email/password) instead of the earlier
 * demo login that accepted anything — see AppSession.signIn. Role comes from the signed-in
 * account's `profiles.role`; signing in with a role that has no mobile access (`viewer`) is
 * rejected with an explanatory message rather than silently mis-routing.
 */
@Composable
fun LoginScreen(session: AppSession) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(horizontal = TpmSpacing.space6),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .size(56.dp)
                .border(BorderStroke(1.dp, TpmColors.Accent)),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.material3.Icon(
                painter = painterResource(R.drawable.ic_tpm_logo_mark),
                contentDescription = null,
                tint = androidx.compose.ui.graphics.Color.Unspecified,
                modifier = Modifier.size(32.dp),
            )
        }
        Spacer(Modifier.height(TpmSpacing.space3))
        Text(
            "RUTF-DTAP",
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        Text(
            "RUTF Digital Traceability & Accountability",
            style = MaterialTheme.typography.bodyMedium,
            color = TpmColors.TextMuted,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(TpmSpacing.space8))

        TpmTextField(
            label = "Email",
            value = email,
            onValueChange = { email = it; error = null },
            placeholder = "name@example.org",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Email,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(TpmSpacing.space3))
        TpmTextField(
            label = "Password",
            value = password,
            onValueChange = { password = it; error = null },
            placeholder = "••••••••",
            isPassword = true,
            modifier = Modifier.fillMaxWidth(),
        )

        if (error != null) {
            Spacer(Modifier.height(TpmSpacing.space2))
            Text(error.orEmpty(), color = TpmColors.Accent800, style = MaterialTheme.typography.bodySmall)
        }

        if (successMessage != null) {
            Spacer(Modifier.height(TpmSpacing.space2))
            Text(successMessage.orEmpty(), color = TpmColors.Accent, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(TpmSpacing.space2))
        TpmButton(
            text = "Forgot password?",
            onClick = {
                if (email.isBlank()) {
                    error = "Enter your email to receive a reset link."
                    return@TpmButton
                }
                error = null
                successMessage = null
                scope.launch {
                    session.sendPasswordResetEmail(email.trim())
                        .onSuccess { successMessage = "Reset link sent to your email." }
                        .onFailure { e -> error = e.message ?: "Failed to send reset link." }
                }
            },
            variant = TpmButtonVariant.Ghost,
            modifier = Modifier.align(Alignment.Start),
        )

        Spacer(Modifier.height(TpmSpacing.space3))
        TpmButton(
            text = if (isSubmitting) "Logging in…" else "Log in",
            onClick = {
                if (email.isBlank() || password.isBlank()) {
                    error = "Enter your email and password."
                    return@TpmButton
                }
                isSubmitting = true
                error = null
                scope.launch {
                    session.signIn(email.trim(), password)
                        // AppSession's offline path now returns a specific reason (wrong
                        // password, no cached account, grace period expired, etc.) — show that
                        // instead of a single generic message that would mask it.
                        .onFailure { e -> error = e.message ?: "Login failed — please try again." }
                    isSubmitting = false
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

        Spacer(Modifier.height(TpmSpacing.space4))
        Text(
            "Works offline: record at the facility without a signal; it syncs when you're back online. Your role and facility load after you sign in.",
            style = MaterialTheme.typography.bodySmall,
            color = TpmColors.TextMuted,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.weight(1.4f))
    }
}
