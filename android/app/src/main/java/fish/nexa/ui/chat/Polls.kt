package fish.nexa.ui.chat

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.crypto.PollPayload
import fish.nexa.data.ChatMessage
import fish.nexa.data.Send
import fish.nexa.media.Media
import fish.nexa.media.TwemojiImage
import fish.nexa.net.ApiError
import fish.nexa.net.PollTally
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.AnchorRef
import fish.nexa.ui.layers.anchor
import fish.nexa.ui.layers.openPopout
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A poll as the card draws it, whoever made it: answers numbered from 1, when it ends, one answer or many. */
data class PollShape(val question: String, val answers: List<Answer>, val expiry: Long, val multi: Boolean) {
    data class Answer(val id: Int, val text: String, val emojiId: String? = null, val emojiName: String? = null, val animated: Boolean = false)

    companion object {
        /** lib/poll.ts hookPollOf: a person's poll, ending when the server says or its hours after it was sent. */
        fun of(p: PollPayload, tally: PollTally?, createdAt: Long) = PollShape(
            p.question,
            p.answers.mapIndexed { i, a -> Answer(i + 1, a.text, a.emoji?.id, a.emoji?.name, a.emoji?.animated == true) },
            tally?.expiresAt ?: (createdAt + p.hours * 3_600_000L),
            p.multiselect,
        )

        fun of(h: fish.nexa.ui.markdown.Webhook.Poll) = PollShape(h.question, h.answers.map { Answer(it.answerId.toInt(), it.text, it.emoji?.id, it.emoji?.name, it.emoji?.animated == true) }, h.expiry.toLong(), h.allowMultiselect)
    }
}

/** A person's poll in their message (MessageItem PersonPoll); a poll still being sent, or one the server keeps no tally for, takes no votes. */
@Composable
fun PollCard(cm: ChatMessage, ctx: ListCtx) {
    val poll = cm.payload?.poll ?: return
    val tally = cm.m.pollResults
    val shape = remember(poll, tally, cm.m.createdAt) { PollShape.of(poll, tally, cm.m.createdAt) }
    PollView(shape, tally, ctx.channel.id, cm.id, readOnly = tally == null)
}

/** timeLeft: how long a poll has, at the precision it deserves. */
fun timeLeft(expiry: Long, now: Long): String {
    val ms = expiry - now
    if (ms <= 60_000) return t("poll.endsSoon")
    val minutes = ms / 60_000
    if (minutes < 60) return t("poll.minutesLeft", "count" to minutes)
    val hours = minutes / 60
    if (hours < 24) return t("poll.hoursLeft", "count" to hours)
    return t("poll.daysLeft", "count" to hours / 24)
}

@Composable
private fun AnswerEmoji(a: PollShape.Answer) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val density = LocalDensity.current.density
    when {
        a.emojiId != null -> AsyncImage(Media.emojiUrl(a.emojiId, 22, density, still = false), a.emojiName, imageLoader = Media.loader, modifier = Modifier.size(22.dp))
        a.emojiName != null -> TwemojiImage(a.emojiName, 22.dp)
    }
}

/**
 * HookPoll.tsx, the one poll view: the question and how to answer, then the
 * answers to pick (a circle, or a square for several) or, once voted, closed
 * or peeked at, the results with a bar behind each and your own answers
 * ticked; a tap on a percentage shows who voted for it. The foot says how
 * many voted and how long is left.
 */
@Composable
fun PollView(poll: PollShape, tally: PollTally?, channelId: String, messageId: String, readOnly: Boolean = false) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val picked = remember(messageId) { mutableStateListOf<Int>() }
    var peek by remember(messageId) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val expiry = tally?.expiresAt ?: poll.expiry
    val closed = tally?.isFinalized == true || (expiry > 0 && expiry <= now)
    val mine = tally?.answerCounts?.filter { it.meVoted }?.map { it.id }?.toSet() ?: emptySet()
    val voted = mine.isNotEmpty()
    val results = closed || voted || peek
    val totalVotes = tally?.answerCounts?.sumOf { it.count } ?: 0
    val counts = tally?.answerCounts?.associate { it.id to it.count } ?: emptyMap()
    val top = counts.values.maxOrNull() ?: 0
    LaunchedEffect(closed, expiry) {
        if (closed || expiry <= 0) return@LaunchedEffect
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    fun send(ids: List<Int>) {
        busy = true
        scope.launch {
            try {
                Send.vote(channelId, messageId, ids)
                picked.clear()
                peek = false
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: t("poll.voteFailed"), "error")
            } finally {
                busy = false
            }
        }
    }
    Column(
        Modifier
            .padding(top = 4.dp)
            .widthIn(max = 440.dp)
            .fillMaxWidth()
            .border(1.dp, c.borderSubtle, Radii.Md)
            .background(c.embedBg, Radii.Md)
            .padding(12.dp)
            .semantics { contentDescription = poll.question },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column {
            Txt(poll.question, style = Nx.type.body.copy(fontSize = Nx.type.sp(17f), lineHeight = Nx.type.sp(22f), fontWeight = FontWeight(600)), color = c.textStrong)
            Txt(
                if (closed) t("poll.closed") else if (poll.multi) t("poll.selectMany") else t("poll.selectOne"),
                style = Nx.type.hint.copy(lineHeight = Nx.type.sp(16f)), color = c.textMuted, modifier = Modifier.padding(top = 4.dp),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (a in poll.answers) {
                val count = counts[a.id] ?: 0
                val share = if (totalVotes > 0) Math.round(count * 100.0 / totalVotes).toInt() else 0
                if (results) ResultRow(a, share, count, a.id in mine, closed && top > 0 && count == top, channelId, messageId)
                else VoteRow(a, a.id in picked, poll.multi, enabled = !busy && !readOnly) {
                    if (poll.multi) { if (a.id in picked) picked.remove(a.id) else picked += a.id }
                    else { val was = a.id in picked; picked.clear(); if (!was) picked += a.id }
                }
            }
        }
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            val foot = Nx.type.hint.copy(fontSize = Nx.type.sp(13f))
            Txt(t("poll.votes", "count" to (tally?.totalVoters ?: 0)), style = foot, color = c.textMuted)
            Txt("•", style = foot, color = c.textMuted)
            Txt(if (closed) t("poll.closed") else if (expiry > 0) timeLeft(expiry, now) else "", style = foot, color = c.textMuted)
            // the actions keep together at the end of the line, or of a line of their own when they do not fit
            if (!closed && !readOnly) Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                Row(Modifier.width(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    when {
                        voted -> PollLink(t("poll.removeVote"), enabled = !busy) { send(emptyList()) }
                        peek -> PollLink(t("poll.backToVoting")) { peek = false }
                        else -> {
                            PollLink(t("poll.showResults")) { peek = true }
                            NxButton(t("poll.vote"), { send(picked.toList()) }, size = ButtonSize.SM, enabled = picked.isNotEmpty(), loading = busy)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PollLink(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Txt(
        label, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = Nx.colors.textSubtle,
        modifier = Modifier.pressable(remember { MutableInteractionSource() }, enabled = enabled, onClick = onClick).padding(vertical = 8.dp, horizontal = 2.dp),
    )
}

/** An answer to pick: 44 dp, its emoji and words, and a circle (a square for several answers) that fills when chosen. */
@Composable
private fun VoteRow(a: PollShape.Answer, checked: Boolean, multi: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val mark = if (multi) RoundedCornerShape(5.dp) else CircleShape
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgActive else c.bgSurface)
            .border(2.dp, if (checked) c.brand else Color.Transparent, Radii.Sm)
            .pressable(interaction, enabled = enabled, role = if (multi) Role.Checkbox else Role.RadioButton, onClick = onClick)
            .semantics { selected = checked }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        AnswerEmoji(a)
        Txt(a.text, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.textStrong, modifier = Modifier.weight(1f))
        Box(
            Modifier.size(20.dp).clip(mark).then(if (checked) Modifier.background(c.brand) else Modifier.border(2.dp, c.textMuted, mark)),
            contentAlignment = Alignment.Center,
        ) { if (checked) Icon("Check", Color.White, size = 14.dp, stroke = 3f) }
    }
}

/** An answer's result: the bar behind it, your tick, and its share as a link to who voted for it. */
@Composable
private fun ResultRow(a: PollShape.Answer, share: Int, count: Int, mine: Boolean, win: Boolean, channelId: String, messageId: String) {
    val c = Nx.colors
    val width by animateFloatAsState(share / 100f, tween(if (Nx.motion.reduced) 0 else 300), label = "share")
    val ref = remember { AnchorRef() }
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(Radii.Sm)
            .background(c.bgSurface)
            .border(2.dp, if (mine) c.brand else Color.Transparent, Radii.Sm),
    ) {
        Box(Modifier.matchParentSize()) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(width).background(if (win) c.brand.copy(alpha = 0.30f) else c.bgSelected))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AnswerEmoji(a)
            Txt(a.text, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.textStrong, modifier = Modifier.weight(1f))
            if (mine) Icon("Check", c.text, size = 16.dp, label = t("poll.yourVote"))
            Txt(
                t("poll.percent", "percent" to share),
                style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textSubtle,
                modifier = Modifier
                    .anchor(ref)
                    .pressable(remember { MutableInteractionSource() }) { openVoters(channelId, messageId, a, ref) }
                    .semantics { contentDescription = t("poll.votesFor", "count" to count, "answer" to a.text) }
                    .padding(vertical = 8.dp, horizontal = 4.dp),
            )
        }
    }
}

/** Who voted for one answer: a small card held to its percentage. */
private fun openVoters(channelId: String, messageId: String, a: PollShape.Answer, ref: AnchorRef) {
    openPopout("poll-voters", ref.rect, 260.dp) { _ ->
        val c = Nx.colors
        var ids by remember { mutableStateOf<List<String>?>(null) }
        val users by Nexa.users.byId.collectAsState()
        LaunchedEffect(Unit) {
            ids = runCatching { Send.voters(channelId, messageId, a.id) }.getOrDefault(emptyList())
            ids?.let { Nexa.session.ensureUsers(it) }
        }
        Column(
            Modifier.width(260.dp).heightIn(max = 320.dp).verticalScroll(rememberScrollState()).padding(8.dp).semantics { contentDescription = t("poll.votersFor", "answer" to a.text) },
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Txt(a.text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700)), color = c.textMuted, modifier = Modifier.padding(4.dp))
            val list = ids
            when {
                list == null -> Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) { Spinner(size = 16.dp) }
                list.isEmpty() -> Txt(t("poll.noVotes"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, modifier = Modifier.padding(4.dp))
                else -> for (id in list) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        val name = Names.shown(id)
                        Avatar(id, name, users[id]?.avatarId, 24.dp)
                        fish.nexa.ui.chat.PersonName(id, name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text, maxLines = 1)
                    }
                }
            }
        }
    }
}
