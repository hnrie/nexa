package fish.nexa.ui.settings

import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * lib/keybinds.ts: the keys that mute, deafen and show or hide activity,
 * written as the web writes them ("Mod+Shift+KeyM", by the key's place, Mod
 * being Ctrl). On a phone they answer to a connected keyboard while Nexa is
 * in front.
 */
object Keybinds {
    val ACTIONS = listOf("mute", "deafen", "activity")
    val DEFAULTS = mapOf("mute" to "Mod+Shift+KeyM", "deafen" to "Mod+Shift+KeyD", "activity" to "")

    data class Combo(val code: String, val mod: Boolean = false, val ctrl: Boolean = false, val alt: Boolean = false, val shift: Boolean = false)

    private val MODIFIER_CODES = setOf("ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "Fn", "FnLock")
    private val CODE = Regex("^[A-Za-z0-9]{1,24}$")

    fun parse(bind: String?): Combo? {
        if (bind.isNullOrEmpty()) return null
        val parts = bind.split("+").toMutableList()
        val code = parts.removeAt(parts.size - 1)
        if (!CODE.matches(code) || code in MODIFIER_CODES) return null
        var c = Combo(code)
        for (p in parts) c = when (p) {
            "Mod" -> c.copy(mod = true)
            "Ctrl" -> c.copy(ctrl = true)
            "Alt" -> c.copy(alt = true)
            "Shift" -> c.copy(shift = true)
            else -> return null
        }
        return c
    }

    fun format(c: Combo): String = listOfNotNull("Mod".takeIf { c.mod }, "Ctrl".takeIf { c.ctrl }, "Alt".takeIf { c.alt }, "Shift".takeIf { c.shift }, c.code).joinToString("+")

    /** Stored binds, read defensively: only the actions there are, each a bind or "" for none. */
    fun saved(x: JsonElement?): Map<String, String> {
        val o = x as? JsonObject ?: return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (a in ACTIONS) {
            val v = (o[a] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: continue
            if (v.isEmpty()) out[a] = "" else parse(v)?.let { out[a] = format(it) }
        }
        return out
    }

    /** What the account chose, the defaults for anything it never set; "" is a key taken off on purpose. */
    fun effective(saved: Map<String, String>): Map<String, String> = ACTIONS.associateWith { a -> saved[a] ?: DEFAULTS.getValue(a) }

    fun standsAlone(code: String): Boolean =
        Regex("^F([1-9]|1[0-9]|2[0-4])$").matches(code) || code.startsWith("Media") || code.startsWith("Audio") || code == "Pause" || code == "ScrollLock" || code == "PrintScreen"

    fun bindable(c: Combo) = c.mod || c.ctrl || c.alt || standsAlone(c.code)

    private val RESERVED = listOf(
        "Mod+KeyK" to "modals.shortcutsHelp.quickSwitcherJumpToAnyConversation", "Mod+Slash" to "modals.shortcutsHelp.thisList",
        "Mod+KeyE" to "modals.shortcutsHelp.openTheEmojiPicker", "Mod+KeyB" to "modals.shortcutsHelp.boldItalicUnderline",
        "Mod+KeyI" to "modals.shortcutsHelp.boldItalicUnderline", "Mod+KeyU" to "modals.shortcutsHelp.boldItalicUnderline",
        "Mod+Shift+KeyX" to "modals.shortcutsHelp.strikeThrough", "Mod+Enter" to "modals.shortcutsHelp.sendFromEditor",
        "Mod+Alt+ArrowLeft" to "modals.shortcutsHelp.switchTabs", "Mod+Alt+ArrowRight" to "modals.shortcutsHelp.switchTabs",
        "Mod+Alt+KeyW" to "modals.shortcutsHelp.closeTheOpenTab", "Alt+ArrowUp" to "modals.shortcutsHelp.previousNextConversation",
        "Alt+ArrowDown" to "modals.shortcutsHelp.previousNextConversation", "Shift+PageUp" to "modals.shortcutsHelp.scrollTheMessages",
        "Shift+PageDown" to "modals.shortcutsHelp.scrollTheMessages", "Mod+KeyC" to "textMenu.copy", "Mod+KeyV" to "textMenu.paste",
        "Mod+KeyX" to "textMenu.cut", "Mod+KeyA" to "textMenu.selectAll", "Mod+KeyZ" to "textMenu.undo", "Mod+KeyY" to "textMenu.redo",
        "Mod+Shift+KeyZ" to "textMenu.redo", "Mod+KeyR" to "shell.errorBoundary.reload",
    )

    fun reservedBy(c: Combo): String? = format(c).let { b -> RESERVED.firstOrNull { it.first == b }?.second }

    private val NAMED = mapOf(
        "Backquote" to "`", "Minus" to "-", "Equal" to "=", "BracketLeft" to "[", "BracketRight" to "]", "Backslash" to "\\",
        "Semicolon" to ";", "Quote" to "'", "Comma" to ",", "Period" to ".", "Slash" to "/", "IntlBackslash" to "\\",
        "ArrowUp" to "↑", "ArrowDown" to "↓", "ArrowLeft" to "←", "ArrowRight" to "→", "PageUp" to "PgUp", "PageDown" to "PgDn",
        "Escape" to "Esc", "Delete" to "Del", "Insert" to "Ins", "PrintScreen" to "PrtSc", "ScrollLock" to "ScrLk",
        "NumpadAdd" to "Num +", "NumpadSubtract" to "Num -", "NumpadMultiply" to "Num *", "NumpadDivide" to "Num /",
        "NumpadDecimal" to "Num .", "NumpadEnter" to "Num Enter", "MediaPlayPause" to "⏯", "MediaTrackNext" to "⏭",
        "MediaTrackPrevious" to "⏮", "MediaStop" to "⏹", "AudioVolumeMute" to "🔇", "AudioVolumeDown" to "🔉", "AudioVolumeUp" to "🔊",
    )

    fun keyName(code: String): String = when {
        code.startsWith("Key") -> code.substring(3)
        code.startsWith("Digit") -> code.substring(5)
        Regex("^Numpad\\d$").matches(code) -> "Num ${code.substring(6)}"
        code == "Space" -> t("keybinds.keys.space")
        code == "Enter" -> t("keybinds.keys.enter")
        code == "Backspace" -> t("keybinds.keys.backspace")
        else -> NAMED[code] ?: code
    }

    /** The keycaps a bind shows: "Ctrl", "Shift", "M". */
    fun caps(c: Combo): List<String> = listOfNotNull("Ctrl".takeIf { c.mod || c.ctrl }, "Alt".takeIf { c.alt }, "Shift".takeIf { c.shift }, keyName(c.code))

    fun text(bind: String?): String = parse(bind)?.let { caps(it).joinToString("+") } ?: ""

    /** KeyboardEvent.code for an Android key, by its place on the keyboard. */
    fun codeOf(keyCode: Int): String? = when (keyCode) {
        in AndroidKeyEvent.KEYCODE_A..AndroidKeyEvent.KEYCODE_Z -> "Key" + ('A' + (keyCode - AndroidKeyEvent.KEYCODE_A))
        in AndroidKeyEvent.KEYCODE_0..AndroidKeyEvent.KEYCODE_9 -> "Digit" + (keyCode - AndroidKeyEvent.KEYCODE_0)
        in AndroidKeyEvent.KEYCODE_F1..AndroidKeyEvent.KEYCODE_F12 -> "F" + (keyCode - AndroidKeyEvent.KEYCODE_F1 + 1)
        in AndroidKeyEvent.KEYCODE_NUMPAD_0..AndroidKeyEvent.KEYCODE_NUMPAD_9 -> "Numpad" + (keyCode - AndroidKeyEvent.KEYCODE_NUMPAD_0)
        AndroidKeyEvent.KEYCODE_GRAVE -> "Backquote"
        AndroidKeyEvent.KEYCODE_MINUS -> "Minus"
        AndroidKeyEvent.KEYCODE_EQUALS -> "Equal"
        AndroidKeyEvent.KEYCODE_LEFT_BRACKET -> "BracketLeft"
        AndroidKeyEvent.KEYCODE_RIGHT_BRACKET -> "BracketRight"
        AndroidKeyEvent.KEYCODE_BACKSLASH -> "Backslash"
        AndroidKeyEvent.KEYCODE_SEMICOLON -> "Semicolon"
        AndroidKeyEvent.KEYCODE_APOSTROPHE -> "Quote"
        AndroidKeyEvent.KEYCODE_COMMA -> "Comma"
        AndroidKeyEvent.KEYCODE_PERIOD -> "Period"
        AndroidKeyEvent.KEYCODE_SLASH -> "Slash"
        AndroidKeyEvent.KEYCODE_SPACE -> "Space"
        AndroidKeyEvent.KEYCODE_ENTER -> "Enter"
        AndroidKeyEvent.KEYCODE_DEL -> "Backspace"
        AndroidKeyEvent.KEYCODE_TAB -> "Tab"
        AndroidKeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
        AndroidKeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
        AndroidKeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
        AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
        AndroidKeyEvent.KEYCODE_PAGE_UP -> "PageUp"
        AndroidKeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
        AndroidKeyEvent.KEYCODE_ESCAPE -> "Escape"
        AndroidKeyEvent.KEYCODE_FORWARD_DEL -> "Delete"
        AndroidKeyEvent.KEYCODE_INSERT -> "Insert"
        AndroidKeyEvent.KEYCODE_SYSRQ -> "PrintScreen"
        AndroidKeyEvent.KEYCODE_SCROLL_LOCK -> "ScrollLock"
        AndroidKeyEvent.KEYCODE_BREAK -> "Pause"
        AndroidKeyEvent.KEYCODE_NUMPAD_ADD -> "NumpadAdd"
        AndroidKeyEvent.KEYCODE_NUMPAD_SUBTRACT -> "NumpadSubtract"
        AndroidKeyEvent.KEYCODE_NUMPAD_MULTIPLY -> "NumpadMultiply"
        AndroidKeyEvent.KEYCODE_NUMPAD_DIVIDE -> "NumpadDivide"
        AndroidKeyEvent.KEYCODE_NUMPAD_DOT -> "NumpadDecimal"
        AndroidKeyEvent.KEYCODE_NUMPAD_ENTER -> "NumpadEnter"
        AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause"
        AndroidKeyEvent.KEYCODE_MEDIA_NEXT -> "MediaTrackNext"
        AndroidKeyEvent.KEYCODE_MEDIA_PREVIOUS -> "MediaTrackPrevious"
        AndroidKeyEvent.KEYCODE_MEDIA_STOP -> "MediaStop"
        AndroidKeyEvent.KEYCODE_VOLUME_MUTE -> "AudioVolumeMute"
        else -> null
    }

    /** The combination a key press makes; null for a modifier on its own or a key with no web name. */
    fun comboOf(e: KeyEvent): Combo? {
        val code = codeOf(e.key.nativeKeyCode) ?: return null
        return Combo(code, mod = e.isCtrlPressed, alt = e.isAltPressed, shift = e.isShiftPressed)
    }

    private val lastRun = HashMap<String, Long>()

    /** A key press anywhere in the app: runs the action it is the bind for, once a press. */
    fun handle(e: KeyEvent): Boolean {
        if (e.type != KeyEventType.KeyDown || e.nativeKeyEvent.repeatCount > 0 || recording) return false
        if (!Nexa.settings.loaded.value) return false
        val combo = comboOf(e) ?: return false
        val binds = effective(saved(Nexa.settings.doc.value["keybinds"]))
        val action = ACTIONS.firstOrNull { parse(binds[it]) == combo } ?: return false
        val now = System.currentTimeMillis()
        if (now - (lastRun[action] ?: 0L) <= 300) return true
        lastRun[action] = now
        when (action) {
            "mute" -> fish.nexa.voice.VoiceLocal.toggleMute()
            "deafen" -> fish.nexa.voice.VoiceLocal.toggleDeafen()
            "activity" -> {
                val sharing = (Nexa.settings.doc.value["shareActivity"] as? JsonPrimitive)?.contentOrNull != "false"
                setSetting("shareActivity", !sharing)
                Nexa.ui.toast(t(if (!sharing) "activityToggle.nowSharing" else "activityToggle.nowHidden"), "info")
            }
        }
        return true
    }

    /** While a row records, key presses are its, not the app's. */
    @Volatile var recording = false
}

/** 3.18 Keybinds: the keys for mute, deafen and activity sharing, set with a keyboard. */
@Composable
fun KeybindsPage(openPage: (String, String?) -> Unit) {
    val c = Nx.colors
    val doc = settingsDoc()
    val saved = Keybinds.saved(doc["keybinds"])
    val binds = Keybinds.effective(saved)
    var recordingFor by remember { mutableStateOf<String?>(null) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    LaunchedEffect(recordingFor) { Keybinds.recording = recordingFor != null }

    fun save(action: String, bind: String) {
        val next = LinkedHashMap(saved).apply { put(action, bind) }
        setSetting("keybinds", JsonObject(next.mapValues { JsonPrimitive(it.value) }))
    }

    PageTitle(t("keybinds.title"))
    Hint(t("keybinds.intro"), Modifier.padding(bottom = 10.dp).settingAnchor("keybinds"))
    for (action in Keybinds.ACTIONS) {
        val name = t("keybinds.actions.$action")
        val combo = Keybinds.parse(binds[action])
        val rec = recordingFor == action
        Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(600)), color = c.text)
            Txt(t("keybinds.actions.${action}Hint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = c.textMuted)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) {
                    when {
                        rec -> Recorder(name, onCancel = { recordingFor = null }) { got ->
                            val other = Keybinds.ACTIONS.firstOrNull { it != action && Keybinds.parse(binds[it]) == got }
                            val reserved = Keybinds.reservedBy(got)
                            errors = errors - action
                            when {
                                !Keybinds.bindable(got) -> errors = errors + (action to t("keybinds.needsModifier"))
                                other != null -> errors = errors + (action to t("keybinds.taken", "action" to t("keybinds.actions.$other")))
                                reserved != null -> errors = errors + (action to t("keybinds.reserved", "what" to t(reserved)))
                                else -> {
                                    save(action, Keybinds.format(got))
                                    recordingFor = null
                                }
                            }
                        }
                        combo != null -> Caps(Keybinds.caps(combo))
                        else -> Txt(t("keybinds.notSet"), style = Nx.type.bodySmall, color = c.textMuted)
                    }
                }
                NxButton(
                    when {
                        rec -> t("look.common.cancel")
                        combo == null -> t("keybinds.setKey")
                        else -> t("settings.security.change")
                    },
                    {
                        errors = errors - action
                        recordingFor = if (rec) null else action
                    },
                    kind = if (combo == null && !rec) ButtonKind.PRIMARY else ButtonKind.SECONDARY, size = ButtonSize.SM,
                )
                if (combo != null && !rec) IconButton("X", t("keybinds.removeKeyFor", "action" to name), { save(action, "") }, tint = c.textMuted, size = 40.dp, iconSize = 16.dp)
            }
            errors[action]?.let { NoticeBox(it, c.danger) }
        }
        Box(Modifier.fillMaxWidth().size(1.dp).background(c.borderSubtle))
    }
    // push to talk is set in Voice & Video; shown here to see every key in one place
    val ptt = (doc.obj("voice")?.get("pttKey") as? JsonPrimitive)?.contentOrNull ?: "`"
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt(t("settings.voice.pushToTalk"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(600)), color = c.text)
        Txt(t("keybinds.pttHint"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = c.textMuted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Caps(listOf(if (ptt.length == 1) ptt.uppercase() else Keybinds.keyName(ptt)))
            NxButton(t("keybinds.pttChange"), { openPage("voice", "inputMode") }, kind = ButtonKind.LINK, inline = true)
        }
    }
    Hint(t("android.keybinds.onPhone"), Modifier.padding(top = 8.dp))
    if (saved.isNotEmpty()) NxButton(t("keybinds.reset"), { setSetting("keybinds", JsonObject(emptyMap())) }, kind = ButtonKind.GHOST, size = ButtonSize.SM, modifier = Modifier.padding(top = 10.dp))
}

/** Keycaps, each a small raised key. */
@Composable
private fun Caps(keys: List<String>) {
    val c = Nx.colors
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (k in keys) Box(
            Modifier
                .heightIn(min = 28.dp)
                .ring(Radii.Xs, c.border)
                .background(c.bgFloating, Radii.Xs)
                .topEdge(Radii.Xs, c.edgeLight)
                .padding(horizontal = 8.dp, vertical = 3.dp),
            contentAlignment = Alignment.Center,
        ) { Txt(k, style = Nx.type.code.copy(fontSize = Nx.type.sp(13f)), color = c.textStrong) }
    }
}

/** Listens for the next key press with a keyboard: Escape cancels, a modifier alone waits for its key. */
@Composable
private fun Recorder(action: String, onCancel: () -> Unit, onCombo: (Keybinds.Combo) -> Unit) {
    val c = Nx.colors
    val focus = remember { FocusRequester() }
    var held by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .sunken(Radii.Sm, c)
            .ring(Radii.Sm, c.focusRing.copy(alpha = 0.7f))
            .focusRequester(focus)
            .focusable()
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) {
                    held = listOfNotNull("Ctrl".takeIf { e.isCtrlPressed }, "Alt".takeIf { e.isAltPressed }, "Shift".takeIf { e.isShiftPressed })
                    return@onPreviewKeyEvent true
                }
                if (e.nativeKeyEvent.repeatCount > 0) return@onPreviewKeyEvent true
                val code = Keybinds.codeOf(e.key.nativeKeyCode)
                if (code == "Escape" && !e.isCtrlPressed && !e.isAltPressed && !e.isShiftPressed) {
                    onCancel()
                    return@onPreviewKeyEvent true
                }
                val combo = Keybinds.comboOf(e)
                if (combo == null) held = listOfNotNull("Ctrl".takeIf { e.isCtrlPressed }, "Alt".takeIf { e.isAltPressed }, "Shift".takeIf { e.isShiftPressed })
                else onCombo(combo)
                true
            }
            .semantics {
                liveRegion = LiveRegionMode.Polite
                contentDescription = t("keybinds.listeningFor", "action" to action)
            }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (held.isNotEmpty()) Caps(held)
        else Txt(t("keybinds.pressKeys"), style = Nx.type.bodySmall.copy(fontWeight = FontWeight(550)), color = c.textBrand)
    }
}
