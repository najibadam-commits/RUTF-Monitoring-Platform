package org.tpmnigeria.tpm.ui.components

import org.tpmnigeria.tpm.ui.theme.TpmRadius
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.tpmnigeria.tpm.R
import org.tpmnigeria.tpm.ui.theme.TpmColors

/**
 * Shared header (glass design, R164: white content on the gradient the app shell draws behind it) —
 * back arrow (space always reserved, invisible+non-interactive when hidden, per
 * the prototype's `visibility:hidden` backBtnStyle so the title never shifts), blueprint app
 * mark + screen title (+ role pill on Home), circular initials avatar. See README "App Structure
 * & Navigation" and the header markup in TPM Field App.dc.html.
 */
@Composable
fun TpmHeader(
    title: String,
    showBack: Boolean,
    onBack: () -> Unit,
    userInitials: String,
    onAvatarClick: () -> Unit,
    modifier: Modifier = Modifier,
    rolePill: String? = null,
) {
    Row(
        modifier = modifier
            .height(60.dp)
            .padding(start = 2.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = onBack,
            enabled = showBack,
            modifier = Modifier.alpha(if (showBack) 1f else 0f),
        ) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = TpmColors.White)
        }

        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // The official logo mark on a white tile (unchanged proportions and colours).
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .background(TpmColors.White, RoundedCornerShape(10.dp))
                    .padding(5.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_tpm_logo_mark),
                    contentDescription = "RUTF-DTAP",
                    tint = Color.Unspecified,
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = TpmColors.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (rolePill != null) {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        rolePill,
                        style = MaterialTheme.typography.labelMedium,
                        color = TpmColors.White,
                        modifier = Modifier
                            .background(Color.White.copy(alpha = 0.22f), RoundedCornerShape(TpmRadius.pill))
                            .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.45f)), RoundedCornerShape(TpmRadius.pill))
                            .padding(horizontal = 10.dp, vertical = 2.dp),
                    )
                }
            }
        }

        Box(
            modifier = Modifier
                .size(40.dp)
                .background(Color.White.copy(alpha = 0.22f), CircleShape)
                .border(BorderStroke(1.5.dp, Color.White.copy(alpha = 0.7f)), CircleShape)
                .clickable(onClickLabel = "Open your profile", onClick = onAvatarClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(userInitials, color = TpmColors.White, style = MaterialTheme.typography.labelLarge)
        }
    }
}
