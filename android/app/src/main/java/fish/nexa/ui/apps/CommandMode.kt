package fish.nexa.ui.apps

import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.utf16CodePoint
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.AppCommands
import fish.nexa.data.Apps
import fish.nexa.data.Interactions
import fish.nexa.data.Pickables
import fish.nexa.net.Channel
import fish.nexa.net.CommandApp
import fish.nexa.net.CommandChoice
import fish.nexa.net.CommandOption
import fish.nexa.net.InteractRequest
import fish.nexa.net.InteractionFile
import fish.nexa.net.PublicUser
import fish.nexa.net.Role
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.server.ServerApi
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * A command of an app being filled in, in the message box (web
 * components/composer/CommandMode.tsx). Picking one from the suggestions turns
 * the box into the command and a slot for each of its options: the ones it
 * needs at once, the others offered after them. A slot takes what its option
 * asks for (words, a number, yes or no, a person, a role, a channel, a file);
 * what can be picked is suggested above the box as it is typed, the app's own
 * suggestions too. Send sends; the command's X, or Backspace through its first
 * slot, leaves it. What is sent goes to the app as it is, not end-to-end
 * encrypted, and the box says so.
 */

/** One option of the command being filled in: what is typed in it, or what was picked for it (and the words it shows as). */
data class CmdSlot(
    val opt: CommandOption,
    val text: String = "",
    val value: JsonPrimitive? = null,
    val label: String? = null,
    val file: InteractionFile? = null,
    val uploading: Boolean = false,
    val error: String? = null,
)

/** What an option asks someone to pick, for the suggestions. */
private fun entityOf(o: CommandOption): EntityKind? = when (o.type) {
    AppCommands.OPT_USER -> EntityKind.USER
    AppCommands.OPT_ROLE -> EntityKind.ROLE
    AppCommands.OPT_MENTIONABLE -> EntityKind.MENTIONABLE
    AppCommands.OPT_CHANNEL -> EntityKind.CHANNEL
    else -> null
}

private fun numeric(o: CommandOption) = o.type == AppCommands.OPT_INTEGER || o.type == AppCommands.OPT_NUMBER

private val WHOLE = Regex("^-?\\d+$")

/** A number as JSON writes it: whole ones without a point. */
private fun numberOf(text: String): Double? = text.toDoubleOrNull()?.takeIf { it.isFinite() }

private fun fmt(n: Double): String = if (n == Math.floor(n) && Math.abs(n) < 1e15) n.toLong().toString() else n.toString()

/** What is wrong with a slot, if anything: the kind of problem, and the number its words need. */
sealed interface SlotIssue {
    data object NeedsFile : SlotIssue
    data object PickFromList : SlotIssue
    data object PickYesNo : SlotIssue
    data object Required : SlotIssue
    data object WholeNumber : SlotIssue
    data object Number : SlotIssue
    data class AtLeast(val n: Double) : SlotIssue
    data class AtMost(val n: Double) : SlotIssue
    data class TooShort(val count: Int) : SlotIssue
    data class TooLong(val count: Int) : SlotIssue
}

/** What is wrong with a slot, or null. */
fun slotIssue(slot: CmdSlot): SlotIssue? {
    val o = slot.opt
    val text = slot.text.trim()
    if (o.type == AppCommands.OPT_ATTACHMENT) return if (slot.file != null) null else SlotIssue.NeedsFile
    if (entityOf(o) != null) return if (slot.value != null) null else SlotIssue.PickFromList
    if (o.type == AppCommands.OPT_BOOLEAN) return if (slot.value != null) null else SlotIssue.PickYesNo
    if (!o.choices.isNullOrEmpty()) return if (slot.value != null) null else SlotIssue.PickFromList
    if (slot.value != null) return null
    if (text.isEmpty()) return if (o.required) SlotIssue.Required else null
    if (numeric(o)) {
        val n = numberOf(text)
        if (n == null || (o.type == AppCommands.OPT_INTEGER && !WHOLE.matches(text))) {
            return if (o.type == AppCommands.OPT_INTEGER) SlotIssue.WholeNumber else SlotIssue.Number
        }
        o.minValue?.let { if (n < it) return SlotIssue.AtLeast(it) }
        o.maxValue?.let { if (n > it) return SlotIssue.AtMost(it) }
        return null
    }
    val len = text.codePointCount(0, text.length)
    o.minLength?.let { if (len < it) return SlotIssue.TooShort(it) }
    o.maxLength?.let { if (len > it) return SlotIssue.TooLong(it) }
    return null
}

/** What is wrong with a slot, in words, or null. */
fun slotProblem(slot: CmdSlot): String? = when (val i = slotIssue(slot)) {
    null -> null
    SlotIssue.NeedsFile -> t("apps.command.needsFile")
    SlotIssue.PickFromList -> t("apps.command.pickFromList")
    SlotIssue.PickYesNo -> t("apps.command.pickYesNo")
    SlotIssue.Required -> t("apps.command.required")
    SlotIssue.WholeNumber -> t("apps.command.wholeNumber")
    SlotIssue.Number -> t("apps.command.number")
    is SlotIssue.AtLeast -> t("apps.command.atLeast", "n" to fmt(i.n))
    is SlotIssue.AtMost -> t("apps.command.atMost", "n" to fmt(i.n))
    is SlotIssue.TooShort -> t("apps.command.tooShort", "count" to i.count)
    is SlotIssue.TooLong -> t("apps.command.tooLong", "count" to i.count)
}

/** A slot's value as the app is sent it, or null when it has none. */
fun slotValue(slot: CmdSlot): JsonPrimitive? {
    val o = slot.opt
    if (o.type == AppCommands.OPT_ATTACHMENT) return slot.file?.let { JsonPrimitive(it.id) }
    slot.value?.let { return it }
    val text = slot.text.trim()
    if (text.isEmpty()) return null
    if (numeric(o)) {
        val n = numberOf(text) ?: return JsonPrimitive(text)
        return if (n == Math.floor(n) && Math.abs(n) < 9.0e15) JsonPrimitive(n.toLong()) else JsonPrimitive(n)
    }
    return JsonPrimitive(text)
}

/** The filled slots' options, for the request; the one being typed in can go as typed, for suggestions. */
private fun filled(slots: List<CmdSlot>, focused: Int? = null): List<AppCommands.Given> {
    val out = ArrayList<AppCommands.Given>()
    slots.forEachIndexed { i, slot ->
        if (i == focused) {
            out += AppCommands.Given(slot.opt.name, JsonPrimitive(slot.text), focused = true)
            return@forEachIndexed
        }
        val v = slotValue(slot)
        if (v != null && slotIssue(slot) == null) out += AppCommands.Given(slot.opt.name, v)
    }
    return out
}

/** Something a slot can take, suggested above the box. */
data class CmdSuggestion(
    val key: String,
    val label: String,
    val value: JsonPrimitive,
    /** The words the slot shows once it is picked. */
    val shown: String,
    val user: PublicUser? = null,
    val role: Role? = null,
    val channel: Channel? = null,
    /** An emoji for ":name" in a text option: what goes in, and its glyph's key to draw. */
    val emojiInsert: String? = null,
    val emojiKey: String? = null,
)

/**
 * The message box's command mode. `onLeave` gets the text the box should hold
 * once the command is left: "/name" when its first slot was backspaced
 * through, nothing when it was sent or put away.
 */
@Stable
class CommandMode(val channelId: String, private val scope: CoroutineScope, private val onLeave: (String) -> Unit) {
    data class Mode(val app: CommandApp, val leaf: AppCommands.Leaf, val slots: List<CmdSlot>, val focus: Int)

    var mode by mutableStateOf<Mode?>(null)
        private set
    var suggestions by mutableStateOf<List<CmdSuggestion>>(emptyList())
        private set
    private var appChoices: List<CommandChoice>? = null
    private var asking: Job? = null

    /** The slot to put the caret in once the box has drawn it (one past the last: the end of the command). */
    var wantFocus by mutableIntStateOf(-1)
        private set
    var focusTick by mutableIntStateOf(0)
        private set

    val active get() = mode != null

    private fun focusSlot(i: Int) {
        wantFocus = i
        focusTick++
    }

    fun focusHandled() {
        wantFocus = -1
    }

    fun start(app: CommandApp, leaf: AppCommands.Leaf) {
        mode = Mode(app, leaf, leaf.options.filter { it.required }.map { CmdSlot(it) }, 0)
        suggestions = emptyList()
        appChoices = null
        // the first slot, or the end of the command when it takes nothing
        focusSlot(0)
        mode?.let { refresh(it) }
    }

    /** The whole command is taken (Ctrl+A on a hardware keyboard), for Backspace to clear it. */
    var allSelected by mutableStateOf(false)
    private var lastSelectAll = -1

    /**
     * A hardware keyboard's Ctrl+A takes the whole command when the caret is
     * in an empty option or past them, or on a second press in one with words
     * (the first takes its words); Backspace or Delete then clears it, and a
     * typed character replaces it (web CommandMode.tsx wholeCommandKey).
     * [at] is the slot, or the number of slots for the end. True when handled.
     */
    fun wholeCommandKey(e: androidx.compose.ui.input.key.KeyEvent, at: Int, text: String): Boolean {
        if (e.type != KeyEventType.KeyDown) return false
        // the modifier keys' own presses change nothing (the Ctrl of a second Ctrl+A among them)
        if (e.key == Key.CtrlLeft || e.key == Key.CtrlRight || e.key == Key.ShiftLeft || e.key == Key.ShiftRight || e.key == Key.MetaLeft || e.key == Key.MetaRight || e.key == Key.AltLeft || e.key == Key.AltRight) return false
        if (e.isCtrlPressed && !e.isAltPressed && !e.isShiftPressed && e.key == Key.A) {
            val second = lastSelectAll == at
            lastSelectAll = at
            if (text.isNotEmpty() && !second) return false
            allSelected = true
            return true
        }
        lastSelectAll = -1
        if (!allSelected) return false
        if (e.key == Key.Backspace || e.key == Key.Delete) {
            allSelected = false
            leave("")
            return true
        }
        val ch = e.utf16CodePoint
        if (ch > 31 && !e.isCtrlPressed && !e.isAltPressed && !e.isMetaPressed) {
            allSelected = false
            leave(String(Character.toChars(ch)))
            return true
        }
        allSelected = false
        return false
    }

    /** What follows a ":" at the end of a text option's words (two letters or more), or null. */
    private fun emojiQuery(slot: CmdSlot): String? {
        if (slot.opt.type != AppCommands.OPT_STRING || slot.value != null || !slot.opt.choices.isNullOrEmpty()) return null
        return Regex("(?:^|\\s):([\\w+-]{2,32})$").find(slot.text)?.groupValues?.get(1)?.lowercase()
    }

    /** Puts what the emoji picker chose into the option being written; false when the caret is in none that takes words. */
    fun insert(text: String): Boolean {
        val m = mode ?: return false
        val slot = m.slots.getOrNull(m.focus) ?: return false
        if (slot.opt.type != AppCommands.OPT_STRING || slot.value != null) return false
        type(m.focus, slot.text + text)
        focusSlot(m.focus)
        return true
    }

    fun leave(text: String = "") {
        allSelected = false
        asking?.cancel()
        mode = null
        suggestions = emptyList()
        onLeave(text)
    }

    /** The suggestions for a slot, for what is typed in it. */
    private fun suggestionsFor(slot: CmdSlot, fromApp: List<CommandChoice>?): List<CmdSuggestion> {
        val o = slot.opt
        // ":name" at the end of an option's words offers emoji, as in the message box (web emojiQuery)
        emojiQuery(slot)?.let { q ->
            val ch = Nexa.channels.get(channelId) ?: return emptyList()
            return fish.nexa.ui.chat.emojiSuggestions(ch, q, raw = true).map { a ->
                CmdSuggestion("e" + a.title + a.insert, a.title, JsonPrimitive(a.insert), a.title, emojiInsert = a.insert.trimEnd(), emojiKey = a.emoji)
            }
        }
        val q = slot.text.trim().lowercase()
        val entity = entityOf(o)
        if (entity != null) {
            val out = ArrayList<CmdSuggestion>()
            if (entity == EntityKind.USER || entity == EntityKind.MENTIONABLE) {
                for (u in Pickables.people(channelId, q, 8)) out += CmdSuggestion("u" + u.id, u.name, JsonPrimitive(u.id), "@${u.name}", user = u)
            }
            if (entity == EntityKind.ROLE || entity == EntityKind.MENTIONABLE) {
                for (r in Pickables.roles(channelId, q, 8)) out += CmdSuggestion("r" + r.id, r.name, JsonPrimitive(r.id), "@${r.name}", role = r)
            }
            if (entity == EntityKind.CHANNEL) {
                for (ch in Pickables.channels(channelId, q, o.channelTypes, 8)) out += CmdSuggestion("c" + ch.id, ch.name, JsonPrimitive(ch.id), "#${ch.name}", channel = ch)
            }
            return out
        }
        if (o.type == AppCommands.OPT_BOOLEAN) {
            return listOf(t("apps.command.true") to true, t("apps.command.false") to false)
                .filter { (name, _) -> q.isEmpty() || name.lowercase().startsWith(q) }
                .map { (name, v) -> CmdSuggestion("v$v", name, JsonPrimitive(v), name) }
        }
        val list = if (o.autocomplete) fromApp.orEmpty() else o.choices.orEmpty().filter { q.isEmpty() || AppCommands.name(it).lowercase().contains(q) }
        return list.take(25).map { c ->
            val name = if (o.autocomplete) c.name else AppCommands.name(c)
            CmdSuggestion("v" + c.value.content, name, c.value, name)
        }
    }

    /** Asks the app for suggestions for what is being typed, a moment after the typing stops. */
    private fun askApp(m: Mode, index: Int) {
        asking?.cancel()
        asking = scope.launch {
            delay(250)
            val o = Interactions.interact(
                InteractRequest(4, m.app.id, channelId, data = buildJsonObject {
                    put("id", m.leaf.command.id)
                    put("options", AppCommands.nest(m.leaf.path, filled(m.slots, index)))
                }),
                quiet = true,
            )
            val cur = mode ?: return@launch
            val slot = cur.slots.getOrNull(cur.focus) ?: return@launch
            if (cur.focus != index) return@launch
            val choices = Interactions.choicesOf(o)
            appChoices = choices
            suggestions = suggestionsFor(slot, choices)
        }
    }

    /** The suggestions follow the slot in focus and what is typed in it. */
    private fun refresh(m: Mode) {
        val slot = m.slots.getOrNull(m.focus)
        if (slot == null) {
            suggestions = emptyList()
            return
        }
        if (slot.opt.autocomplete) {
            appChoices = null
            askApp(m, m.focus)
        }
        if (entityOf(slot.opt) != null) scope.launch {
            Pickables.findMembers(channelId, slot.text)
            val cur = mode
            if (cur != null && cur.focus == m.focus) cur.slots.getOrNull(cur.focus)?.let { suggestions = suggestionsFor(it, null) }
        }
        suggestions = suggestionsFor(slot, if (slot.opt.autocomplete) appChoices else null)
    }

    fun type(i: Int, text: String) {
        val m = mode ?: return
        // with the whole command taken, an edit through the keyboard (which sends no key
        // events) clears it, or replaces it with what was typed
        if (allSelected) {
            val old = m.slots.getOrNull(i)?.text.orEmpty()
            val typed = if (text.length > old.length && text.startsWith(old)) text.substring(old.length) else if (text.length > old.length) text else ""
            allSelected = false
            leave(typed)
            return
        }
        val next = m.copy(slots = m.slots.mapIndexed { j, s -> if (j == i) s.copy(text = text, error = null) else s }, focus = i)
        mode = next
        refresh(next)
    }

    /** A slot came into focus: its suggestions show. */
    fun focused(i: Int) {
        val m = mode ?: return
        val next = if (m.focus != i) m.copy(focus = i) else m
        mode = next
        refresh(next)
    }

    /** The end of the command came into focus: no suggestions. */
    fun focusedTail() {
        suggestions = emptyList()
        mode?.let { mode = it.copy(focus = it.slots.size) }
    }

    fun pick(s: CmdSuggestion) {
        val m = mode ?: return
        val i = m.focus
        if (s.emojiInsert != null) {
            // the ":name" typed becomes the emoji itself, as a message carries it
            val slot = m.slots[i]
            val q = emojiQuery(slot)
            val text = if (q == null) slot.text + s.emojiInsert else slot.text.dropLast(q.length + 1) + s.emojiInsert
            mode = m.copy(slots = m.slots.mapIndexed { j, x -> if (j == i) x.copy(text = text, error = null) else x })
            suggestions = emptyList()
            focusSlot(i)
            return
        }
        val slots = m.slots.mapIndexed { j, slot -> if (j == i) slot.copy(value = s.value, label = s.shown, text = "", error = null) else slot }
        // on to the next slot still empty, if there is one
        val nextEmpty = slots.withIndex().indexOfFirst { (j, slot) -> j > i && slotValue(slot) == null }
        val focus = if (nextEmpty >= 0) nextEmpty else i
        val next = m.copy(slots = slots, focus = focus)
        mode = next
        suggestions = emptyList()
        if (nextEmpty >= 0) {
            focusSlot(nextEmpty)
            refresh(next)
        } else {
            // every slot it needs is filled: the caret goes to the end, where Send sends
            focusSlot(slots.size)
        }
    }

    /** A picked value goes, so something else can be picked or typed. */
    fun unpick(i: Int) {
        val m = mode ?: return
        val next = m.copy(slots = m.slots.mapIndexed { j, s -> if (j == i) s.copy(value = null, label = null, file = null) else s }, focus = i)
        mode = next
        focusSlot(i)
        refresh(next)
    }

    fun addOption(opt: CommandOption) {
        val m = mode ?: return
        val slots = m.slots + CmdSlot(opt)
        val next = m.copy(slots = slots, focus = slots.size - 1)
        mode = next
        focusSlot(slots.size - 1)
        refresh(next)
    }

    fun removeSlot(i: Int) {
        val m = mode ?: return
        val slots = m.slots.filterIndexed { j, _ -> j != i }
        val focus = maxOf(0, i - 1)
        mode = m.copy(slots = slots, focus = focus)
        suggestions = emptyList()
        focusSlot(focus)
    }

    /** Backspace with nothing left before the caret: a picked value goes, an empty optional slot goes, else back a slot (out of the command from the first). */
    fun backspace(i: Int) {
        val m = mode ?: return
        val slot = m.slots.getOrNull(i)
        if (slot == null) {
            if (m.slots.isNotEmpty()) focusSlot(m.slots.size - 1) else leave("/${m.leaf.label}")
            return
        }
        when {
            slot.value != null || slot.file != null -> unpick(i)
            slot.text.isNotEmpty() -> Unit
            !slot.opt.required -> removeSlot(i)
            i > 0 -> focusSlot(i - 1)
            // back through the first slot: the command goes back to being words
            else -> leave("/${m.leaf.label}")
        }
    }

    /** Sends the command; false when something is missing, which the slot then says. */
    fun submit(): Boolean {
        val m = mode ?: return false
        val problems = m.slots.map(::slotProblem)
        val first = problems.indexOfFirst { it != null }
        if (first >= 0) {
            mode = m.copy(slots = m.slots.mapIndexed { j, s -> s.copy(error = problems[j]) }, focus = first)
            focusSlot(first)
            return false
        }
        if (m.slots.any { it.uploading }) return false
        val options = filled(m.slots)
        scope.launch {
            Interactions.interact(InteractRequest(2, m.app.id, channelId, data = buildJsonObject {
                put("id", m.leaf.command.id)
                put("options", AppCommands.nest(m.leaf.path, options))
            }))
        }
        leave("")
        return true
    }

    fun uploading(i: Int, on: Boolean, file: InteractionFile? = null, error: String? = null) {
        val m = mode ?: return
        mode = m.copy(slots = m.slots.mapIndexed { j, s -> if (j == i) s.copy(uploading = on, file = file ?: s.file, error = error) else s })
    }
}

/**
 * The command and its slots, in place of the message box's words: the app's
 * picture and the command's name, a slot per option (a well holding what is
 * typed, or a chip of what was picked), the options it can also take, and an
 * X that puts the command away.
 */
@Composable
fun CommandBox(cm: CommandMode, modifier: Modifier = Modifier) {
    val m = cm.mode ?: return
    val c = Nx.colors
    val context = LocalContext.current
    val requesters = remember(m.leaf) { HashMap<Int, FocusRequester>() }
    fun requester(i: Int) = requesters.getOrPut(i) { FocusRequester() }
    LaunchedEffect(cm.focusTick) {
        val i = cm.wantFocus
        if (i < 0) return@LaunchedEffect
        cm.focusHandled()
        // the slot is drawn by now; a frame later if it has only just been added
        repeat(3) {
            if (runCatching { requester(i).requestFocus() }.isSuccess) return@LaunchedEffect
            delay(16)
        }
    }
    var filePick by remember { mutableIntStateOf(-1) }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val i = filePick
        if (uri == null || i < 0) return@rememberLauncherForActivityResult
        cm.uploading(i, true)
        Nexa.scope.launch {
            try {
                val picked = ServerApi.read(context, uri)
                cm.uploading(i, false, file = Apps.sendFile(picked.name, picked.type, picked.bytes))
            } catch (e: Exception) {
                cm.uploading(i, false, error = describeError(e, t("apps.form.fileFailed")))
            }
        }
    }
    FlowRow(
        modifier
            .fillMaxWidth()
            // Ctrl+A took the whole command: it reads as selected text does
            .then(if (cm.allSelected) Modifier.background(c.brand.copy(alpha = 0.32f), Radii.Sm) else Modifier)
            .padding(vertical = 8.dp)
            .semantics { contentDescription = t("apps.command.label", "command" to m.leaf.label) },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Avatar(m.app.id, m.app.name, m.app.bot?.avatarId, 20.dp)
            Txt("/${m.leaf.label}", style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(650)), color = c.textBrand, maxLines = 1, modifier = Modifier.widthIn(max = 220.dp))
            SmallX(t("apps.command.close")) { cm.leave("") }
        }
        m.slots.forEachIndexed { i, slot ->
            val o = slot.opt
            val name = AppCommands.name(o)
            val focused = m.focus == i
            val shape = Radii.Sm
            Row(
                Modifier
                    .heightIn(min = 36.dp)
                    .sunken(shape, c)
                    .then(
                        when {
                            slot.error != null -> Modifier.border(1.dp, c.textDanger, shape)
                            focused -> Modifier.ring(shape, c.focusRing.copy(alpha = 0.7f), 2.dp)
                            else -> Modifier.border(1.dp, c.borderSubtle, shape)
                        },
                    )
                    .padding(start = 10.dp, end = 4.dp)
                    .semantics { slot.error?.let { error(it) } },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Txt(name, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(650)), color = c.textMuted, maxLines = 1)
                val picked = slot.label ?: slot.value?.let { v -> Pickables.label(cm.channelId, v.contentOrNull ?: "") }
                when {
                    o.type == AppCommands.OPT_ATTACHMENT -> Row(
                        Modifier
                            .heightIn(min = 32.dp)
                            .focusRequester(requester(i))
                            .pressable(remember { MutableInteractionSource() }) {
                                filePick = i
                                pickFile.launch("*/*")
                            },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon("FileUp", c.link, size = 14.dp)
                        Txt(
                            if (slot.uploading) t("apps.command.uploading") else slot.file?.filename ?: t("apps.command.chooseFile"),
                            style = Nx.type.bodySmall.copy(fontWeight = FontWeight(550)), color = c.link, maxLines = 1, modifier = Modifier.widthIn(max = 180.dp),
                        )
                    }
                    picked != null -> Box(
                        Modifier
                            .height(26.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(c.mentionBg)
                            .focusRequester(requester(i))
                            .pressable(remember { MutableInteractionSource() }) { cm.unpick(i) }
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Txt(picked, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = c.mentionFg, maxLines = 1, modifier = Modifier.widthIn(max = 180.dp))
                    }
                    else -> BasicTextField(
                        value = slot.text,
                        onValueChange = { cm.type(i, it) },
                        modifier = Modifier
                            .widthIn(min = 40.dp, max = 240.dp)
                            .width(androidx.compose.foundation.layout.IntrinsicSize.Min)
                            .focusRequester(requester(i))
                            .onFocusChanged { if (it.isFocused) cm.focused(i) }
                            .onPreviewKeyEvent { e ->
                                if (cm.wholeCommandKey(e, i, slot.text)) true
                                else if (e.type == KeyEventType.KeyDown && e.key == Key.Backspace && slot.text.isEmpty()) {
                                    cm.backspace(i)
                                    true
                                } else false
                            }
                            .semantics { contentDescription = "$name: ${AppCommands.description(o)}" },
                        textStyle = Nx.type.body.copy(fontSize = Nx.type.sp(15f), color = c.text),
                        cursorBrush = SolidColor(c.text),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = if (o.type == AppCommands.OPT_INTEGER) KeyboardType.Number else if (o.type == AppCommands.OPT_NUMBER) KeyboardType.Decimal else KeyboardType.Text,
                            imeAction = ImeAction.Send,
                        ),
                        keyboardActions = KeyboardActions(onSend = {
                            val first = cm.suggestions.firstOrNull()
                            if (first != null && slot.text.isNotEmpty()) cm.pick(first) else cm.submit()
                        }),
                    )
                }
                if (!o.required) SmallX(t("apps.command.removeOption", "name" to name)) { cm.removeSlot(i) }
                else Box(Modifier.width(2.dp))
            }
        }
        for (o in m.leaf.options.filter { o -> !o.required && m.slots.none { it.opt.name == o.name } }) {
            val interaction = remember(o.name) { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Row(
                Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (pressed) c.bgHover else Color.Transparent)
                    .border(1.dp, c.border, RoundedCornerShape(999.dp))
                    .pressable(interaction) { cm.addOption(o) }
                    .semantics { contentDescription = "${AppCommands.name(o)}: ${AppCommands.description(o)}" }
                    .padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon("Plus", c.textMuted, size = 12.dp)
                Txt(AppCommands.name(o), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textMuted, maxLines = 1)
            }
        }
        // the caret's place after the command and its slots: a command that takes nothing sends from here.
        // It fills the rest of the last line (Composer.module.css .cmdTail), and needs only a sliver of
        // it to stay there rather than wrap onto an empty line of its own.
        BasicTextField(
            value = "",
            onValueChange = {},
            modifier = Modifier
                .weight(1f)
                .width(4.dp)
                .height(32.dp)
                .focusRequester(requester(m.slots.size))
                .onFocusChanged { if (it.isFocused) cm.focusedTail() }
                .onPreviewKeyEvent { e ->
                    if (cm.wholeCommandKey(e, m.slots.size, "")) true
                    else if (e.type == KeyEventType.KeyDown && e.key == Key.Backspace) {
                        cm.backspace(m.slots.size)
                        true
                    } else false
                },
            cursorBrush = SolidColor(c.text),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { cm.submit() }),
        )
    }
}

@Composable
private fun SmallX(label: String, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(28.dp)
            .clip(CircleShape)
            .background(if (pressed) c.bgHover else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon("X", if (pressed) c.textStrong else c.icon, size = 14.dp) }
}

/**
 * Above the box while a command is filled in: suggestions for the slot being
 * filled, or what its option asks for and that the app reads what it is sent
 * as it is.
 */
@Composable
fun CommandList(cm: CommandMode, modifier: Modifier = Modifier) {
    val m = cm.mode ?: return
    val c = Nx.colors
    val focused = m.slots.getOrNull(m.focus)
    // docked on the box (web .docked): rounded only at its top, joined to the box under it
    val dockShape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)
    val panel = modifier
        .fillMaxWidth()
        .ring(dockShape, c.panelEdge)
        .background(c.bgFloating, dockShape)
        .topEdge(dockShape, c.edgeLight)
    if (cm.suggestions.isNotEmpty()) {
        Column(panel.heightIn(max = fish.nexa.ui.chat.dockedListMax()).verticalScroll(rememberScrollState()).padding(8.dp)) {
            if (focused != null) Txt(
                "${AppCommands.name(focused.opt)}: ${AppCommands.description(focused.opt)}",
                style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(650)),
                color = c.textMuted, maxLines = 1,
                modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp),
            )
            cm.suggestions.forEachIndexed { i, s ->
                val interaction = remember(s.key) { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                val selected = i == 0
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(40.dp)
                        .then(if (selected || pressed) Modifier.ring(Radii.Sm, c.brand.copy(alpha = 0.24f)).background(c.brand.copy(alpha = 0.18f), Radii.Sm) else Modifier)
                        .clip(Radii.Sm)
                        .pressable(interaction) { cm.pick(s) }
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    when {
                        s.user != null -> Avatar(s.user.id, s.user.name, s.user.avatarId, 24.dp)
                        s.role != null -> Icon("AtSign", s.role.color.takeIf { it != 0L }?.let { mixSrgb(c.textStrong, Color(0xFF000000 or it), 0.72f) } ?: c.icon, size = 18.dp)
                        s.channel != null -> Icon("Hash", c.textMuted, size = 18.dp)
                        s.emojiKey != null -> fish.nexa.ui.chat.EmojiGlyph(s.emojiKey, 22.dp)
                    }
                    Txt(s.label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                    if (s.user != null) Txt(s.user.username, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
                }
            }
        }
        return
    }
    FlowRow(
        panel.padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.Start),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        if (focused != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(AppCommands.name(focused.opt), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1)
            Txt(focused.error ?: AppCommands.description(focused.opt), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = if (focused.error != null) c.textDanger else c.textMuted)
        } else if (m.leaf.description.isNotEmpty()) Txt(m.leaf.description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = c.textMuted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon("LockOpen", c.textMuted, size = 13.dp)
            Txt(t("apps.command.notEncrypted", "app" to m.app.name), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
        }
    }
}

/** The floating panel the suggestions sit on, as the message box's own suggestions do. */
@Composable
private fun Modifier.floatingPanel(): Modifier {
    val c = Nx.colors
    val shape = Radii.Md
    return this.shadowHigh(shape, c).ring(shape, c.panelEdge).background(c.bgFloating, shape).topEdge(shape, c.edgeLight)
}
