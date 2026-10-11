package org.tpmnigeria.tpm.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.tpmnigeria.tpm.R
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.ui.components.TpmButton
import org.tpmnigeria.tpm.ui.components.TpmButtonVariant
import org.tpmnigeria.tpm.ui.components.TpmGradientBackground
import org.tpmnigeria.tpm.ui.components.TpmTextField
import org.tpmnigeria.tpm.ui.components.glass
import org.tpmnigeria.tpm.ui.theme.TpmColors
import org.tpmnigeria.tpm.ui.theme.TpmRadius
import org.tpmnigeria.tpm.ui.theme.TpmSpacing

/**
 * README §1 Login, backed by real Supabase Auth (email/password) — see AppSession.signIn. Role
 * comes from the signed-in account's `profiles.role`; a role with no mobile access (`viewer`) is
 * rejected with an explanatory message. Glass design (DECISIONS R164): a blue → turquoise gradient
 * with soft shapes, the logo on a white tile, and a floating sign-in panel. Only the controls the
 * app supports are shown (no registration, social or biometric sign-in).
 */
@Composable
fun LoginScreen(session: AppSession) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }
    var isSubmitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (email.isBlank() || password.isBlank()) {
            error = "Enter your email and password."
            return
        }
        isSubmitting = true
        error = null
        scope.launch {
            session.signIn(email.trim(), password)
                // AppSession's offline path returns a specific reason (wrong password, no cached
                // account, grace period expired, etc.) — show that, not one generic message.
                .onFailure { e -> error = e.message ?: "Login failed — please try again." }
            isSubmitting = false
        }
    }

    TpmGradientBackground(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = TpmSpacing.space6, vertical = TpmSpacing.space6),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Spacer(Modifier.height(TpmSpacing.space8))
            // The official logo mark, unchanged, on a white tile.
            Box(
                modifier = Modifier
                    .size(76.dp)
                    .shadow(10.dp, RoundedCornerShape(22.dp), ambientColor = Color.Black.copy(alpha = 0.2f), spotColor = Color.Black.copy(alpha = 0.2f))
                    .background(TpmColors.White, RoundedCornerShape(22.dp))
                    .padding(14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_tpm_logo_mark),
                    contentDescription = "RUTF-DTAP logo",
                    tint = Color.Unspecified,
                    modifier = Modifier.size(46.dp),
                )
            }
            Spacer(Modifier.height(TpmSpacing.space4))
            Text("RUTF-DTAP", style = MaterialTheme.typography.headlineMedium, color = TpmColors.White, textAlign = TextAlign.Center)
            Text(
                "RUTF Digital Traceability & Accountability",
                style = MaterialTheme.typography.bodyMedium,
                color = TpmColors.White.copy(alpha = 0.92f),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(TpmSpacing.space6))

            // The floating sign-in panel (high opacity so the form reads in sunlight).
            Column(
                modifier = Modifier
                    .widthIn(max = 460.dp)
                    .fillMaxWidth()
                    .glass(RoundedCornerShape(TpmRadius.large), elevation = 14.dp, surface = TpmColors.White.copy(alpha = 0.97f))
                    .padding(TpmSpacing.space6),
                verticalArrangement = Arrangement.spacedBy(TpmSpacing.space3),
            ) {
                Text("Welcome back", style = MaterialTheme.typography.headlineSmall, color = TpmColors.Text, fontWeight = FontWeight.SemiBold)
                Text("Sign in with your programme account to record stock, OTP visits and Findings.",
                    style = MaterialTheme.typography.bodyMedium, color = TpmColors.TextMuted)
                TpmTextField(
                    label = "Email",
                    value = email,
                    onValueChange = { email = it; error = null },
                    placeholder = "name@example.org",
                    keyboardType = androidx.compose.ui.text.input.KeyboardType.Email,
                    modifier = Modifier.fillMaxWidth(),
                )
                TpmTextField(
                    label = "Password",
                    value = password,
                    onValueChange = { password = it; error = null },
                    placeholder = "Your password",
                    isPassword = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                error?.let {
                    Text(it, color = TpmColors.Error, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().background(TpmColors.ErrorBg, RoundedCornerShape(10.dp)).padding(10.dp))
                }
                successMessage?.let {
                    Text(it, color = TpmColors.Success, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().background(TpmColors.SuccessBg, RoundedCornerShape(10.dp)).padding(10.dp))
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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
                    )
                }

                TpmButton(
                    text = if (isSubmitting) "Signing in…" else "Sign in",
                    onClick = { submit() },
                    enabled = !isSubmitting,
                    blueprint = true,
                    fullWidth = true,
                )
                if (isSubmitting) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = TpmColors.Accent)
                    }
                }
            }

            Spacer(Modifier.height(TpmSpacing.space4))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.widthIn(max = 460.dp)) {
                Icon(Icons.Filled.CloudOff, contentDescription = null, tint = TpmColors.White, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(
                    "Works offline: record at the facility without a signal; it syncs when you're back online. Your role and facility load after you sign in.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TpmColors.White.copy(alpha = 0.95f),
                )
            }
            Spacer(Modifier.height(TpmSpacing.space6))
        }
    }
}
