package fish.nexa.ui.profile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Fingerprint
import fish.nexa.data.KeyPins
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.launch

/**
 * profile/KeyVerify.tsx and the two dialogs built on it: someone's identity
 * key as thirty digits two people can read to each other, and the same
 * digits as a QR code; and the question asked before anything is sealed to a
 * key that has changed.
 */
object KeyDialogs {
    /** A changed key is asked about as soon as it is seen. */
    fun install() {
        Nexa.alerts.onKeyChange = { openKeyChange() }
        if (Nexa.alerts.pending.value.isNotEmpty()) openKeyChange()
    }

    /** verdictFor: what this device can say about someone's key; one learned a moment ago is "first", not "same". */
    fun verdict(userId: String, publicKey: String?): KeyPins.Verdict {
        if (publicKey.isNullOrEmpty()) return KeyPins.Verdict.UNKNOWN
        val v = Nexa.pins.check(userId, publicKey)
        return if (v == KeyPins.Verdict.SAME && Nexa.pins.learnedThisSession(userId)) KeyPins.Verdict.FIRST else v
    }

    fun openVerify(userId: String) {
        lateinit var layer: Layer
        layer = Layer("verifyKey", replaces = "verifyKey") { close -> VerifySheet(layer, userId, close) }
        Layers.open(layer)
    }

    fun openKeyChange() {
        if (Layers.stack.any { it.key == "keyChange" }) return
        lateinit var layer: Layer
        // closing it any way but Accept is Not Now, for the one it is showing
        layer = Layer("keyChange", canClose = {
            Nexa.alerts.pending.value.values.firstOrNull()?.let { Nexa.alerts.reject(it.userId) }
            true
        }) { close -> KeyChangeSheet(layer, close) }
        Layers.open(layer)
    }

    fun myKey(): String? = Nexa.keys.identity?.let { Bytes.b64(it.publicKey) } ?: Nexa.users.me.value?.publicKey?.ifEmpty { null }
}

/** KeyStatusChip: what this device knows of someone's key, which opens the safety number. */
@Composable
fun KeyStatusChip(userId: String, onClick: (() -> Unit)? = { KeyDialogs.openVerify(userId) }) {
    val c = Nx.colors
    val pending by Nexa.alerts.pending.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val verdict = if (pending.containsKey(userId)) KeyPins.Verdict.CHANGED else KeyDialogs.verdict(userId, users[userId]?.publicKey)
    if (verdict == KeyPins.Verdict.UNKNOWN) return
    val (icon, label) = when (verdict) {
        KeyPins.Verdict.CHANGED -> "ShieldAlert" to t("encryption.chipChanged")
        KeyPins.Verdict.SAME -> "ShieldCheck" to t("encryption.chipKnown")
        else -> "ShieldQuestion" to t("encryption.chipNew")
    }
    val fg = when (verdict) {
        KeyPins.Verdict.CHANGED -> c.textDanger
        KeyPins.Verdict.SAME -> c.textStrong
        else -> c.textMuted
    }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(999.dp)
    val fill = if (verdict == KeyPins.Verdict.CHANGED) c.danger.copy(alpha = 0.2f) else if (pressed) mixSrgb(c.bgActive, c.text, 0.14f) else c.bgActive
    Row(
        Modifier
            .height(24.dp)
            .ring(shape, c.borderSubtle)
            .background(fill, shape)
            .then(if (onClick != null) Modifier.pressable(interaction, onClick = onClick).semantics { contentDescription = "$label. ${t("encryption.openSafetyNumber")}" } else Modifier)
            .padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(icon, fg, size = 13.dp)
        Txt(label, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = fg, maxLines = 1)
    }
}

/** A QR code drawn module by module, black on white with four modules of quiet zone, error correction M. */
@Composable
fun QrCode(text: String, size: Dp, label: String) {
    val matrix = remember(text) { Encoder.encode(text, ErrorCorrectionLevel.M).matrix }
    Canvas(Modifier.size(size).semantics { contentDescription = label }) {
        val n = matrix.width
        val span = n + 8
        val cell = this.size.width / span
        drawRect(Color.White)
        for (y in 0 until n) for (x in 0 until n) {
            if (matrix.get(x, y).toInt() == 1) drawRect(Color.Black, Offset((x + 4) * cell, (y + 4) * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}

/** SafetyNumber: the thirty digits in two rows of three groups, and the QR code that carries them. */
@Composable
fun SafetyNumber(publicKey: String, qr: Boolean = true, old: Boolean = false) {
    val c = Nx.colors
    val digits = remember(publicKey) { Fingerprint.ofB64(publicKey) }
    if (digits == null) {
        KeyNote(t("encryption.noKeyToShow"))
        return
    }
    val groups = digits.split(" ")
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SelectionContainer {
            Column(
                Modifier.fillMaxWidth().background(c.bgInput, Radii.Md).padding(horizontal = 14.dp, vertical = 12.dp).semantics { contentDescription = digits },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                for (row in groups.chunked(3)) Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    for (g in row) Txt(
                        g,
                        style = Nx.type.code.copy(fontSize = Nx.type.sp(if (old) 15f else 17f), lineHeight = Nx.type.sp(26f), letterSpacing = 0.06.em),
                        color = c.textStrong.copy(alpha = if (old) 0.75f else 1f),
                        align = TextAlign.Center,
                    )
                }
            }
        }
        if (qr) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { QrCode(digits, 168.dp, t("encryption.safetyNumberQr")) }
    }
}

@Composable
private fun KeyNote(text: String, icon: Boolean = false) {
    val c = Nx.colors
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (icon) Icon("KeyRound", c.textMuted, size = 13.dp, modifier = Modifier.padding(top = 2.5.dp))
        Txt(text, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18f)), color = c.textMuted)
    }
}

@Composable
private fun KeyWarn(text: String) {
    val c = Nx.colors
    Txt(
        text,
        style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(20f)),
        color = c.text,
        modifier = Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.12f), Radii.Md).padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

@Composable
private fun KeyPair(label: String, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Txt(label, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textStrong)
        content()
    }
}

/** KeyVerifyBody: your key and theirs side by side, so the comparison asked for is plain. */
@Composable
private fun KeyVerifyBody(userId: String, name: String) {
    val c = Nx.colors
    val pending by Nexa.alerts.pending.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val me by Nexa.users.me.collectAsState()
    val mine = KeyDialogs.myKey()
    val compare = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(20f))
    if (userId == me?.id) {
        Txt(t("encryption.selfKeyIntro"), style = compare, color = c.text)
        if (mine != null) SafetyNumber(mine) else KeyNote(t("encryption.noKeyToShow"))
        KeyNote(t("encryption.noteWhatThisProves"), icon = true)
        return
    }
    val theirs = users[userId]?.publicKey?.ifEmpty { null }
    val verdict = if (pending.containsKey(userId)) KeyPins.Verdict.CHANGED else KeyDialogs.verdict(userId, theirs)
    Txt(t("encryption.compareInstruction", "name" to name), style = compare, color = c.text)
    KeyPair(t("encryption.yourKeyLabel")) { if (mine != null) SafetyNumber(mine) else KeyNote(t("encryption.noKeyToShow")) }
    KeyPair(t("encryption.contactKeyLabel", "name" to name)) { if (theirs != null) SafetyNumber(theirs) else KeyNote(t("encryption.noKeyToShow")) }
    when (verdict) {
        KeyPins.Verdict.SAME -> KeyNote(t("encryption.noteSameSinceFirstSeen", "name" to name))
        KeyPins.Verdict.FIRST -> KeyNote(if (Nexa.pins.startedBlank) t("encryption.noteNoMemoryYet") else t("encryption.noteFirstSeenNow", "name" to name))
        KeyPins.Verdict.CHANGED -> KeyWarn(t("encryption.noteChanged", "name" to name))
        else -> Unit
    }
    KeyNote(t("encryption.noteWhatThisProves"), icon = true)
}

@Composable
private fun VerifySheet(layer: Layer, userId: String, close: () -> Unit) {
    val users by Nexa.users.byId.collectAsState()
    val name = if (userId == Nexa.users.meId) t("encryption.yourOwnKey") else Names.display(users[userId])
    Sheet(layer, title = t("encryption.safetyNumberTitle"), maxWidth = 420.dp, footer = {
        NxButton(t("modals.serverNotifications.done"), close, block = true)
    }) {
        KeyVerifyBody(userId, name)
    }
}

/** KeyChangeModal: nothing is sealed to a changed key until this is answered. */
@Composable
private fun KeyChangeSheet(layer: Layer, close: () -> Unit) {
    val pending by Nexa.alerts.pending.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    var busy by remember { mutableStateOf(false) }
    val change = pending.values.firstOrNull()
    if (change == null) {
        // the last one was answered: there is nothing left to ask about
        androidx.compose.runtime.LaunchedEffect(Unit) { Layers.remove(layer) }
        return
    }
    val name = Names.display(users[change.userId])
    Sheet(layer, title = t("encryption.keyChangedTitle", "name" to name), maxWidth = 420.dp, closeButton = false, footer = {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End), modifier = Modifier.fillMaxWidth()) {
            NxButton(t("encryption.keyChangedNotNow"), {
                Nexa.alerts.reject(change.userId)
                if (Nexa.alerts.pending.value.isEmpty()) Layers.remove(layer)
            }, kind = ButtonKind.GHOST)
            NxButton(t("encryption.keyChangedAccept"), {
                busy = true
                Nexa.alerts.accept(change.userId)
                // what was held back while the question stood is handed over now
                Nexa.scope.launch {
                    try {
                        Nexa.keys.reconcile()
                    } catch (_: Exception) {
                    }
                    busy = false
                }
                if (Nexa.alerts.pending.value.isEmpty()) Layers.remove(layer)
            }, kind = ButtonKind.DANGER, loading = busy)
        }
    }) {
        KeyWarn(t("encryption.keyChangedWarning", "name" to name))
        KeyPair(t("encryption.keyChangedNewLabel")) { SafetyNumber(change.offered) }
        KeyPair(t("encryption.keyChangedOldLabel")) { SafetyNumber(change.pinned, qr = false, old = true) }
        KeyNote(t("encryption.keyChangedMeaning", "name" to name))
        if (pending.size > 1) KeyNote(t("encryption.keyChangedMore", "count" to pending.size - 1))
    }
}
