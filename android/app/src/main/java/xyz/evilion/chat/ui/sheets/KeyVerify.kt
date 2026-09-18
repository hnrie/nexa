package xyz.evilion.chat.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import xyz.evilion.chat.crypto.Fingerprint
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.KeyAlerts
import xyz.evilion.chat.data.KeyPins
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.detached
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.theme.chatColors

/**
 * Showing an identity key to a person, and asking about one that changed.
 * Mirrors web/src/components/profile/KeyVerify.tsx.
 *
 * Remembering the key first seen for someone only catches a key that *changes*.
 * A key that was the server's own from the very first sight is invisible to the
 * device, because there is nothing to compare against — only two people
 * checking somewhere the server cannot reach closes that. So the thirty digits
 * are on screen, short enough to read down a phone line.
 */

/** The thirty digits, grouped, in a block that can be read aloud. */
@Composable
fun SafetyNumber(publicKeyB64: String, dim: Boolean = false) {
    val colors = chatColors
    val digits = remember(publicKeyB64) { Fingerprint.ofB64(publicKeyB64) }
    if (digits == null) {
        Text(t("encryption.noKeyToShow"), color = colors.textMuted, fontSize = 13.sp)
        return
    }
    val groups = digits.split(" ")
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(colors.bgInput).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        // Six groups in two rows of three: one long run of thirty digits is
        // where the eye slips when two people are comparing.
        for (row in groups.chunked(3)) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                for (g in row) {
                    Text(
                        g,
                        color = if (dim) colors.textMuted else colors.textStrong,
                        fontSize = if (dim) 14.sp else 16.sp,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
    }
}

/**
 * The profile row: what this device knows about someone's key, and the digits
 * behind it. "Not checked yet" is deliberately not "verified" — saying
 * otherwise would be the same silence the product used to keep.
 */
@Composable
fun KeyVerifyRow(userId: String, name: String) {
    val colors = chatColors
    val users by AppState.users.collectAsState()
    val pending by KeyAlerts.pending.collectAsState()
    var open by remember { mutableStateOf(false) }
    val key = users[userId]?.publicKey.orEmpty()
    if (key.isEmpty()) return
    val changed = pending[userId] != null
    // A key this device only learned a moment ago counts as a first sighting,
    // not as one it remembers: a second device pins everybody within a second
    // of connecting, and saying "same key as before" straight afterwards would
    // claim a check that never happened. The grant path does not use this —
    // there a pin is a pin — but what a person is told has to be true.
    val verdict = when {
        changed -> KeyPins.Verdict.CHANGED
        KeyPins.learnedThisSession(userId) -> KeyPins.Verdict.FIRST
        else -> KeyPins.check(userId, key)
    }
    val (icon, tint, label) = when (verdict) {
        KeyPins.Verdict.CHANGED -> Triple(Lucide.ShieldAlert, colors.danger, t("encryption.chipChanged"))
        KeyPins.Verdict.SAME -> Triple(Lucide.ShieldCheck, colors.textSubtle, t("encryption.chipKnown"))
        else -> Triple(Lucide.Shield, colors.textMuted, t("encryption.chipNew"))
    }

    Spacer(Modifier.height(12.dp))
    Text(t("encryption.encryptionKey"), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(4.dp))
    Row(
        Modifier.clip(RoundedCornerShape(10.dp)).clickable { open = !open }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(15.dp), tint = tint)
        Spacer(Modifier.width(6.dp))
        Text(label, color = tint, fontSize = 13.sp)
        Spacer(Modifier.width(6.dp))
        Icon(if (open) Lucide.ChevronUp else Lucide.ChevronDown, null, Modifier.size(14.dp), tint = colors.textMuted)
    }
    if (open) {
        Spacer(Modifier.height(8.dp))
        Text(t("encryption.compareInstruction", "name" to name), color = colors.text, fontSize = 13.sp)
        Spacer(Modifier.height(8.dp))
        SafetyNumber(key)
        Spacer(Modifier.height(8.dp))
        val note = when (verdict) {
            KeyPins.Verdict.CHANGED -> t("encryption.noteChanged", "name" to name)
            KeyPins.Verdict.SAME -> t("encryption.noteSameSinceFirstSeen", "name" to name)
            else -> if (KeyPins.startedWithNoPins()) t("encryption.noteNoMemoryYet") else t("encryption.noteFirstSeenNow", "name" to name)
        }
        Text(note, color = colors.textMuted, fontSize = 12.sp)
        Spacer(Modifier.height(4.dp))
        Text(t("encryption.noteWhatThisProves"), color = colors.textMuted, fontSize = 12.sp)
    }
}

/**
 * The question that has to be answered before a conversation key is sealed to a
 * changed identity key.
 *
 * There is no path in the API that changes a user's public_key — registration
 * writes it and nothing else touches it, and registering again produces a new
 * account with a new id — so a key that changes under a name that has not is
 * either the database having been restored, or somebody standing between this
 * device and the person it thinks it is talking to. Until this is answered the
 * client seals nothing to the new key, which is a pause the person has to be
 * told about rather than one they simply suffer.
 */
@Composable
fun KeyChangeDialog() {
    val colors = chatColors
    val pending by KeyAlerts.pending.collectAsState()
    val users by AppState.users.collectAsState()
    val change = pending.values.firstOrNull() ?: return
    val name = users[change.userId]?.name ?: AppState.nameFor(change.userId)

    Dialog(onDismissRequest = { KeyAlerts.reject(change.userId) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(24.dp).clip(RoundedCornerShape(14.dp)).background(colors.bgFloating).padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Lucide.ShieldAlert, null, Modifier.size(20.dp), tint = colors.danger)
                Spacer(Modifier.width(8.dp))
                Text(
                    t("encryption.keyChangedTitle", "name" to name),
                    color = colors.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(t("encryption.keyChangedWarning", "name" to name), color = colors.text, fontSize = 14.sp)
            Spacer(Modifier.height(14.dp))
            Text(t("encryption.keyChangedNewLabel"), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            SafetyNumber(change.offered)
            Spacer(Modifier.height(10.dp))
            Text(t("encryption.keyChangedOldLabel"), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            SafetyNumber(change.pinned, dim = true)
            Spacer(Modifier.height(12.dp))
            Text(t("encryption.keyChangedMeaning", "name" to name), color = colors.textMuted, fontSize = 12.sp)
            if (pending.size > 1) {
                Spacer(Modifier.height(6.dp))
                Text(t("encryption.keyChangedMore", "count" to pending.size - 1), color = colors.textMuted, fontSize = 12.sp)
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { KeyAlerts.reject(change.userId) }) {
                    Text(t("encryption.keyChangedNotNow"), color = colors.textSubtle)
                }
                TextButton(onClick = {
                    KeyAlerts.accept(change.userId)
                    // Whatever was withheld while the question stood is handed
                    // over now; the server is asked afresh what is still owed
                    // rather than anything being replayed.
                    detached { runCatching { KeyService.reconcile() } }
                }) {
                    Text(t("encryption.keyChangedAccept"), color = colors.danger)
                }
            }
        }
    }
}
