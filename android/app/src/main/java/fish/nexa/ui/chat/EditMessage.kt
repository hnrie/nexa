package fish.nexa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.placeCursorAtEnd
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.ChatMessage
import fish.nexa.data.Mentions
import fish.nexa.data.Send
import fish.nexa.net.ApiError
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.launch

/**
 * EditMessage.tsx: the message's words in an editable box where they were,
 * grown to fit (up to 400 dp), the caret at the end. Enter is a new line on a
 * phone; Save and Cancel sit under it. Leaving the conversation parks the
 * edit, and it comes back with its text.
 */
@Composable
fun EditMessage(cm: ChatMessage) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val parked = ChatUi.editing[cm.channelId]
    val original = remember(cm.id) { Mentions.humanizeForEdit(cm.payload?.t ?: "", cm.channelId) }
    val state = remember(cm.id) { TextFieldState(parked?.text?.takeIf { parked.messageId == cm.id } ?: original).apply { edit { placeCursorAtEnd() } } }
    var busy by remember { mutableStateOf(false) }
    var held by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(cm.id) { runCatching { focus.requestFocus() } }
    LaunchedEffect(cm.id) {
        snapshotFlow { state.text.toString() }.collect { ChatUi.editing[cm.channelId] = ChatUi.Edit(cm.id, it) }
    }

    fun end() {
        if (ChatUi.editing[cm.channelId]?.messageId == cm.id) ChatUi.editing.remove(cm.channelId)
    }

    fun save() {
        if (busy) return
        val body = state.text.toString().trim()
        if (body.isEmpty() && cm.payload?.att.isNullOrEmpty() && cm.payload?.sticker == null) {
            confirmDelete(cm) { end() }
            return
        }
        if (Send.tooLong(body)) {
            Nexa.ui.toast(Send.tooLongMessage(), "error")
            return
        }
        if (body == original.trim()) return end()
        busy = true
        scope.launch {
            try {
                Send.editMessage(cm.channelId, cm.id, body)
                end()
            } catch (e: Exception) {
                Nexa.ui.toast(Send.errorText(e) ?: (e as? ApiError)?.message ?: t("chat.editMessage.couldNotSaveTheEdit"), "error")
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        held?.let { pasted ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(c.bgSurface, Radii.Sm)
                    .padding(start = 0.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(3.dp).heightIn(min = 44.dp).background(c.warning))
                Txt(
                    t("composer.composer.pasteTooLong", "count" to Send.MAX_MESSAGE_LENGTH),
                    style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text,
                    modifier = Modifier.weight(1f).padding(start = 12.dp, top = 6.dp, bottom = 6.dp),
                )
                NxButton(t("composer.composer.pasteAnyway"), {
                    state.edit { replace(selection.min, selection.max, pasted) }
                    held = null
                }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                Box(
                    Modifier.padding(start = 4.dp).pressable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) { held = null }
                        .semantics { contentDescription = t("composer.composer.dismiss") }.padding(10.dp),
                ) { Icon("X", c.textMuted, size = 16.dp) }
            }
        }
        BasicTextField(
            state = state,
            enabled = !busy,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 400.dp)
                .focusRequester(focus)
                .background(c.bgComposer, Radii.Sm)
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .semantics { contentDescription = t("composer.editYourMessage") },
            textStyle = Nx.type.body.copy(color = c.text),
            cursorBrush = SolidColor(c.text),
            keyboardOptions = messageKeyboard(),
            lineLimits = TextFieldLineLimits.MultiLine(1, Int.MAX_VALUE),
            inputTransformation = EditInput { held = it },
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val left = Send.MAX_MESSAGE_LENGTH - state.text.length
            if (left < 200) Txt(
                left.toString(),
                style = Nx.type.hint.copy(fontWeight = if (left < 0) FontWeight(600) else FontWeight(400), fontFeatureSettings = "tnum"),
                color = if (left < 0) c.textDanger else c.textMuted,
            )
            Spacer(Modifier.weight(1f))
            NxButton(t("chat.editMessage.cancel"), { end() }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, modifier = Modifier.heightIn(min = 40.dp))
            NxButton(t("chat.editMessage.save"), { save() }, size = ButtonSize.SM, loading = busy, modifier = Modifier.heightIn(min = 40.dp))
        }
    }
}

/** The editor's rules: no zalgo, and a paste that would pass the limit is held back to ask first. */
private class EditInput(private val onHeld: (String) -> Unit) : InputTransformation {
    override fun TextFieldBuffer.transformInput() {
        val text = asCharSequence().toString()
        if (Zalgo.tooStacked(text)) {
            revertAllChanges()
            Zalgo.refused()
            return
        }
        if (text.length > Send.MAX_MESSAGE_LENGTH && text.length - originalText.length > 1 && changes.changeCount > 0) {
            val r = changes.getRange(0)
            val pasted = text.substring(r.start, r.end)
            revertAllChanges()
            onHeld(pasted)
        }
    }
}
