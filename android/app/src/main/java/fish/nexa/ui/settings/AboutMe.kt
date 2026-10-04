package fish.nexa.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Mentions
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.markdown.Mentions as Md
import fish.nexa.ui.markdown.ShortcodeTyping
import fish.nexa.ui.pickers.Pickers
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii

/**
 * An About Me as it is saved and as it is written (AboutMeEditor.tsx): each
 * custom emoji written as its :name: is saved as the emoji, as sending a
 * message does, and goes back to its :name: for writing where that name
 * brings the same emoji back. @names stay words.
 */
object AboutMe {
    /** The longest About Me the server keeps (internal/api/user_handlers.go maxAboutMe). */
    const val MAX = 1000

    /** The custom emoji an About Me can show: any this account can use whose name is not a standard emoji's. */
    private fun scope(): Md.Scope {
        val all = Mentions.scope("")
        return Md.Scope(emoji = all.emoji, isShortcode = all.isShortcode)
    }

    fun toSave(text: String): String = Md.extract(text, emptyMap(), scope()).text

    fun toEdit(saved: String): String {
        val scope = scope()
        return Md.humanize(saved, emptyMap(), Md.HumanNames(emoji = { token, name -> Md.extract(":$name:", emptyMap(), scope).text == token }))
    }
}

/** The closing colon of a :name: turns it into its emoji as it goes in, as in the message box; the box keeps to [max]. */
private class AboutInput(private val max: Int) : InputTransformation {
    override fun TextFieldBuffer.transformInput() {
        val text = asCharSequence().toString()
        if (text.length == originalText.length + 1 && changes.changeCount == 1) {
            val r = changes.getRange(0)
            if (r.end - r.start == 1 && text[r.start] == ':') {
                val closed = ShortcodeTyping.closeShortcode(text, selection.end, Nexa.settings.skinTone)
                if (closed != null) {
                    replace(0, length, closed.first.take(max))
                    selection = TextRange(minOf(closed.second, length))
                    return
                }
            }
        }
        if (length > max) {
            if (originalText.length >= max) revertAllChanges() else replace(max, length, "")
        }
    }
}

/**
 * The About Me box, written the way a message is: a :name: becomes its emoji
 * as its closing colon goes in, and the emoji picker and the formatting
 * editor sit along its foot. What it holds is markdown, which a profile shows
 * with the same renderer as a message.
 */
@Composable
fun AboutMeEditor(state: TextFieldState, max: Int, placeholder: String, label: String, focus: Boolean = false) {
    val c = Nx.colors
    val requester = remember { FocusRequester() }
    LaunchedEffect(focus) { if (focus) requester.requestFocus() }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val style = Nx.type.input.copy(fontSize = Nx.type.sp(16f), lineHeight = Nx.type.sp(22f), color = c.text)
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.bgInput, Radii.Xs)
            .border(1.dp, if (focused) c.borderStrong else androidx.compose.ui.graphics.Color.Transparent, Radii.Xs),
    ) {
        BasicTextField(
            state,
            Modifier
                .fillMaxWidth()
                .heightIn(min = 132.dp)
                .focusRequester(requester)
                .padding(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 4.dp)
                .semantics { contentDescription = label },
            inputTransformation = remember(max) { AboutInput(max) },
            textStyle = style,
            cursorBrush = SolidColor(c.focusRing),
            interactionSource = interaction,
            keyboardOptions = fish.nexa.ui.chat.messageKeyboard(),
            decorator = { inner ->
                Box {
                    if (state.text.isEmpty()) fish.nexa.ui.components.Txt(placeholder, style = style, color = c.textPlaceholder)
                    inner()
                }
            },
        )
        Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End)) {
            IconButton("Type", t("composer.format.open"), {
                fish.nexa.ui.format.openFormattingEditor(
                    initial = state.text.toString(),
                    placeholder = placeholder,
                    onInsert = { md -> state.setTextAndPlaceCursorAtEnd(md.take(max)) },
                    title = t("settings.profile.formatAboutMe"),
                    max = max,
                )
            }, tint = c.icon, size = 44.dp, iconSize = 20.dp)
            IconButton("Smile", t("composer.composer.selectEmoji"), { openAboutEmoji(state, max) }, tint = c.icon, size = 44.dp, iconSize = 20.dp)
        }
    }
}

/** The emoji picker for the About Me: an emoji goes in at the caret, a custom one as its :name: where that name brings it back. */
private fun openAboutEmoji(state: TextFieldState, max: Int) {
    Pickers.open(
        Pickers.Opener(listOf(Pickers.Tab.EMOJI), null, closeOnEmoji = true, onEmoji = { p ->
            val name = p.custom?.name ?: p.packEmoji?.name
            val short = name?.let { ":$it:" }
            val words = (if (short != null && AboutMe.toSave(short) == p.text) short else p.text) + " "
            state.edit {
                val start = selection.min
                val end = selection.max
                val room = max - (length - (end - start))
                if (room <= 0) return@edit
                val put = words.take(room)
                replace(start, end, put)
                selection = TextRange(start + put.length)
            }
        }),
    )
}
