package fish.nexa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.crypto.MessageCrypto
import fish.nexa.crypto.PollAnswer
import fish.nexa.crypto.PollEmoji
import fish.nexa.crypto.PollPayload
import fish.nexa.data.Send
import fish.nexa.media.Media
import fish.nexa.media.TwemojiImage
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ToggleLine
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.pickers.Pickers
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii

/** How long a poll runs: 1 hour to 2 weeks, a day unless chosen otherwise. */
private val DURATIONS = listOf(1, 4, 8, 24, 72, 168, 336)

private fun durationLabel(hours: Int): String = when {
    hours % 168 == 0 -> t("nexa.span.weeks", "count" to hours / 168)
    hours % 24 == 0 -> t("nexa.span.days", "count" to hours / 24)
    else -> t("nexa.span.hours", "count" to hours)
}

private class AnswerRow {
    var text by mutableStateOf("")
    var emoji by mutableStateOf<PollEmoji?>(null)
}

/**
 * CreatePollModal: a question, two to ten answers (each may carry an emoji),
 * how long it runs and whether more than one answer may be picked. Posting
 * sends it as a message, encrypted like any other.
 */
fun openCreatePoll(channelId: String) {
    val serverId = Nexa.channels.get(channelId)?.serverId
    val rows = mutableStateListOf(AnswerRow(), AnswerRow())
    var question by mutableStateOf("")
    var hours by mutableStateOf(24)
    var multi by mutableStateOf(false)
    fun ready() = question.isNotBlank() && rows.count { it.text.isNotBlank() } >= MessageCrypto.POLL_ANSWERS_MIN
    fun post(close: () -> Unit) {
        if (!ready()) return
        val answers = rows.filter { it.text.isNotBlank() }.map { PollAnswer(it.text.trim(), it.emoji) }
        close()
        ChatUi.snapToBottom(channelId)
        val reply = ChatUi.reply.remove(channelId)
        Send.sendMessage(channelId, "", fish.nexa.data.SendOptions(replyTo = reply?.messageId, ping = reply?.ping, poll = PollPayload(question.trim(), answers, hours, multi)))
    }
    openSheet(
        "create-poll",
        title = t("poll.create.title"),
        footer = { close ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
                NxButton(t("poll.create.post"), { post(close) }, enabled = ready())
            }
        },
    ) { close ->
        val c = Nx.colors
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            NxTextField(
                question, { question = it.take(MessageCrypto.POLL_QUESTION_MAX) },
                label = t("poll.create.question"), required = true, placeholder = t("poll.create.questionPlaceholder"),
                imeAction = ImeAction.Next, capitalize = true,
            )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(t("poll.create.answers"), style = Nx.type.label, color = c.textSubtle)
                rows.forEachIndexed { i, row ->
                    val number = i + 1
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        EmojiButton(row, number, serverId)
                        NxTextField(
                            row.text, { row.text = it.take(MessageCrypto.POLL_ANSWER_MAX) },
                            modifier = Modifier.weight(1f).semantics { contentDescription = t("poll.create.answerNumber", "number" to number) },
                            placeholder = t("poll.create.answerPlaceholder"),
                            imeAction = if (i == rows.lastIndex) ImeAction.Done else ImeAction.Next,
                            onIme = if (i == rows.lastIndex) ({ post(close) }) else null,
                            capitalize = true,
                        )
                        if (rows.size > MessageCrypto.POLL_ANSWERS_MIN) RemoveButton(number) { rows.removeAt(i) }
                    }
                }
                if (rows.size < MessageCrypto.POLL_ANSWERS_MAX) AddAnswer { rows += AnswerRow() }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(t("poll.create.duration"), style = Nx.type.label, color = c.textSubtle)
                DurationField(hours) { picked -> hours = picked }
            }
            ToggleLine(t("poll.create.multiselect"), multi, { multi = it })
        }
    }
}

@Composable
private fun EmojiButton(row: AnswerRow, number: Int, serverId: String?) {
    val c = Nx.colors
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    Box {
        Box(
            Modifier
                .size(44.dp, 40.dp)
                .clip(Radii.Xs)
                .background(c.bgInput)
                .pressable(remember { MutableInteractionSource() }) {
                    Pickers.open(Pickers.Opener(listOf(Pickers.Tab.EMOJI), serverId, thisServerOnly = true, draggable = false, closeOnEmoji = true, onEmoji = { p ->
                        row.emoji = when {
                            p.custom != null -> PollEmoji(p.custom.name, p.custom.blobId, p.custom.animated)
                            else -> PollEmoji(p.text)
                        }
                    }))
                }
                .semantics { contentDescription = if (row.emoji == null) t("poll.create.addEmoji", "number" to number) else t("poll.create.changeEmoji", "number" to number) },
            contentAlignment = Alignment.Center,
        ) {
            val e = row.emoji
            when {
                e == null -> Icon("SmilePlus", c.textMuted, size = 20.dp)
                e.id != null -> AsyncImage(Media.emojiUrl(e.id, 24, density), e.name, Modifier.size(24.dp))
                else -> TwemojiImage(e.name, 24.dp)
            }
        }
        if (row.emoji != null) Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 8.dp, y = (-8).dp)
                .size(24.dp)
                .background(c.bgFloating, CircleShape)
                .border(1.dp, c.borderSubtle, CircleShape)
                .pressable(remember { MutableInteractionSource() }) { row.emoji = null }
                .semantics { contentDescription = t("poll.create.removeEmoji", "number" to number) },
            contentAlignment = Alignment.Center,
        ) { Icon("X", c.textMuted, size = 12.dp) }
    }
}

@Composable
private fun RemoveButton(number: Int, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier.size(44.dp).pressable(interaction, onClick = onClick).semantics { contentDescription = t("poll.create.removeAnswer", "number" to number) },
        contentAlignment = Alignment.Center,
    ) { Icon("Trash2", if (pressed) c.danger else c.icon, size = 16.dp) }
}

/** Add Answer: a dashed row under the answers. */
@Composable
private fun AddAnswer(onClick: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .drawBehind {
                val r = 6.dp.toPx()
                drawRoundRect(c.border, cornerRadius = CornerRadius(r), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f))))
            }
            .clip(Radii.Xs)
            .pressable(remember { MutableInteractionSource() }, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(44.dp), contentAlignment = Alignment.Center) { Icon("Plus", c.textMuted, size = 18.dp) }
        Txt(t("poll.create.addAnswer"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.textMuted)
    }
}

/** The duration as a field that opens its choices. */
@Composable
private fun DurationField(hours: Int, pick: (Int) -> Unit) {
    val c = Nx.colors
    val shape = Radii.Sm
    Row(
        Modifier
            .fillMaxWidth()
            .height(44.dp)
            .background(c.bgInput, shape)
            .border(1.dp, c.borderSubtle, shape)
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }) {
                openMenu(DURATIONS.map { h -> MenuItem.Action(durationLabel(h), checked = h == hours) { pick(h) } }, title = t("poll.create.duration"), haptic = false)
            }
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(durationLabel(hours), style = Nx.type.body, color = c.text, modifier = Modifier.weight(1f))
        Icon("ChevronDown", c.textMuted, size = 18.dp)
    }
}
