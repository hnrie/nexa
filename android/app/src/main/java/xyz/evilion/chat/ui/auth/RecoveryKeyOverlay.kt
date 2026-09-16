package xyz.evilion.chat.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import xyz.evilion.chat.ui.theme.chatColors

/**
 * The recovery key, shown once.
 *
 * Without it a forgotten password means every message on the account stays
 * sealed forever, so this sits over everything until it has been acknowledged.
 */
@Composable
fun RecoveryKeyOverlay(key: String, onDone: () -> Unit) {
    val colors = chatColors
    val clipboard = LocalClipboardManager.current
    Dialog(onDismissRequest = { }, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Column(
            Modifier.fillMaxSize().background(colors.bgBase).systemBarsPadding().padding(28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.Key, null, tint = colors.brand, modifier = Modifier.size(44.dp))
            Spacer(Modifier.height(16.dp))
            Text("Save your recovery key", color = colors.textStrong, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "This is shown once. Without it, a forgotten password means losing every message on this account.",
                color = colors.textMuted, fontSize = 14.sp, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.bgInput).padding(18.dp)) {
                Text(
                    key,
                    color = colors.textStrong,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 16.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { clipboard.setText(AnnotatedString(key)) }) {
                Icon(Icons.Filled.ContentCopy, null, Modifier.size(16.dp), tint = colors.textBrand)
                Spacer(Modifier.size(6.dp))
                Text("Copy", color = colors.textBrand)
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = onDone,
                colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text("I have written it down", fontWeight = FontWeight.SemiBold) }
        }
    }
}
