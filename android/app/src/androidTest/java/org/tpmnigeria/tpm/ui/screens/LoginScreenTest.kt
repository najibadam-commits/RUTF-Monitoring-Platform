package org.tpmnigeria.tpm.ui.screens

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.tpmnigeria.tpm.session.AppSession
import org.tpmnigeria.tpm.ui.theme.TpmTheme
import org.junit.Rule
import org.junit.Test
import org.mockito.Mockito.mock

class LoginScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun loginScreen_showsTitle() {
        val mockSession = mock(AppSession::class.java)
        
        composeTestRule.setContent {
            TpmTheme {
                LoginScreen(session = mockSession)
            }
        }

        composeTestRule.onNodeWithText("TPM Process Monitoring").assertExists()
        composeTestRule.onNodeWithText("Email").assertExists()
        composeTestRule.onNodeWithText("Password").assertExists()
    }

    @Test
    fun loginScreen_showsErrorOnEmptyLogin() {
        val mockSession = mock(AppSession::class.java)
        
        composeTestRule.setContent {
            TpmTheme {
                LoginScreen(session = mockSession)
            }
        }

        composeTestRule.onNodeWithText("Log in").performClick()
        composeTestRule.onNodeWithText("Enter your email and password.").assertExists()
    }
}
