package fish.nexa.ui.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.crypto.PollPayload
import fish.nexa.data.ChatMessage
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx

/**
 * SystemMessage.tsx: a line about the conversation itself (someone joined,
 * left, pinned something, a poll closed), never grouped and without a menu.
 * Names open the person; "a message" and "View Poll" jump to what they name.
 */
@Composable
fun SystemRow(cm: ChatMessage, ctx: ListCtx) {
    val c = Nx.colors
    val m = cm.m
    val sid = ctx.server?.server?.id
    val actor = m.authorId
    val target = m.mentions.firstOrNull()
    val icon = when (m.type) {
        "system_member_remove" -> "ArrowLeftFromLine"
        "system_owner_change" -> "Crown"
        "system_pin" -> "Pin"
        "system_poll_result" -> "ChartBar"
        "system_call" -> "Phone"
        else -> "ArrowRightToLine"
    }
    val nameStyle = SpanStyle(color = c.textStrong, fontWeight = FontWeight(500))
    val linkStyle = TextLinkStyles(SpanStyle(color = c.link))
    // a closed poll's question and answers: from the list, or fetched when the list does not hold the poll (usePollOf.ts)
    val held = if (m.type == "system_poll_result") m.replyToId?.let { Nexa.messages.get(ctx.channel.id).byId[it]?.payload?.poll } else null
    val fetched by produceState<PollPayload?>(null, m.replyToId, held == null) {
        val id = m.replyToId
        if (m.type == "system_poll_result" && held == null && id != null) value = FetchedPolls.load(ctx.channel.id, id)
    }
    val poll = held ?: fetched

    /** Fills a translated sentence, putting a tappable name or link where each {placeholder} is. */
    fun fill(template: String, parts: Map<String, AnnotatedString.Builder.() -> Unit>): AnnotatedString = buildAnnotatedString {
        var i = 0
        val rx = Regex("\\{(\\w+)\\}")
        for (match in rx.findAll(template)) {
            append(template.substring(i, match.range.first))
            val fn = parts[match.groupValues[1]]
            if (fn != null) fn() else append(match.value)
            i = match.range.last + 1
        }
        append(template.substring(i))
    }

    fun person(id: String?): AnnotatedString.Builder.() -> Unit = {
        if (id == null) append(t("chat.systemMessage.someone"))
        else withLink(LinkAnnotation.Clickable("user-$id", styles = TextLinkStyles(nameStyle)) { openProfile(id) }) { append(Names.member(sid, id)) }
    }

    fun jumpLink(label: String, to: String?): AnnotatedString.Builder.() -> Unit = {
        if (to == null) append(label)
        else withLink(LinkAnnotation.Clickable("jump-$to", styles = linkStyle) { ChatUi.jumpTo(ctx.channel.id, to) }) { append(label) }
    }

    val self = target == null || target == actor
    val text: AnnotatedString = when (m.type) {
        "system_member_add" -> if (self) fill(t("chat.systemMessage.joinedGroup"), mapOf("actor" to person(actor)))
        else fill(t("chat.systemMessage.addedToGroup"), mapOf("actor" to person(actor), "target" to person(target)))
        "system_member_remove" -> if (self) fill(t("chat.systemMessage.leftGroup"), mapOf("actor" to person(actor)))
        else fill(t("chat.systemMessage.removedFromGroup"), mapOf("actor" to person(actor), "target" to person(target)))
        "system_owner_change" -> if (self) fill(t("chat.systemMessage.tookOwnership"), mapOf("actor" to person(actor)))
        else fill(t("chat.systemMessage.madeOwner"), mapOf("actor" to person(actor), "target" to person(target)))
        "system_pin" -> fill(t("chat.systemMessage.pinned"), mapOf("actor" to person(actor), "message" to jumpLink(t("chat.systemMessage.aMessage"), m.replyToId)))
        "system_join" -> fill(t("chat.systemMessage.joined"), mapOf("actor" to person(actor)))
        "system_poll_result" -> pollResult(cm, poll, ::fill, person(actor), jumpLink(t("chat.systemMessage.viewPoll"), m.replyToId))
        else -> fill(t("chat.systemMessage.didSomething"), mapOf("actor" to person(actor)))
    }
    val full = buildAnnotatedString {
        append(text)
        withStyle(SpanStyle(fontSize = Nx.type.sp(12f), color = c.textMuted)) { append("  " + Time.timestamp(m.createdAt)) }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .padding(top = 17.dp)
            .heightIn(min = 26.dp)
            .padding(start = if (ctx.selecting) 98.dp else 64.dp, end = 16.dp, top = 4.dp, bottom = 4.dp),
    ) {
        Icon(icon, c.textMuted, size = 18.dp, modifier = Modifier.padding(top = 2.dp).offsetStart(if (ctx.selecting) -44 else -40))
        BasicText(full, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), lineHeight = Nx.type.sp(22f), color = c.textMuted))
    }
}

/** The icon sits in the avatar gutter: 24 dp from the row's start edge (54 while picking). */
private fun Modifier.offsetStart(dp: Int): Modifier = this.layout { measurable, constraints ->
    val p = measurable.measure(constraints)
    layout(0, p.height) { p.placeRelative((dp * density).toInt(), 0) }
}

/** Polls read from messages the list does not hold, by message id, each fetched once (usePollOf.ts loadPoll). */
private object FetchedPolls {
    private val polls = java.util.concurrent.ConcurrentHashMap<String, PollPayload>()
    /** Gone, or out of reach, stays so; a moment offline does not. */
    private val unreachable = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    suspend fun load(channelId: String, messageId: String): PollPayload? {
        polls[messageId]?.let { return it }
        if (messageId in unreachable) return null
        return try {
            val m = Nexa.api.get("/channels/$channelId/messages/$messageId", fish.nexa.net.Message.serializer())
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { Nexa.messages.decrypt(m) }.payload?.poll?.also { polls[messageId] = it }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: fish.nexa.net.ApiError) {
            if (e.status == 404 || e.status == 403) unreachable += messageId
            null
        } catch (_: Exception) {
            null
        }
    }
}

private fun pollResult(
    cm: ChatMessage,
    poll: PollPayload?,
    fill: (String, Map<String, AnnotatedString.Builder.() -> Unit>) -> AnnotatedString,
    actor: AnnotatedString.Builder.() -> Unit,
    view: AnnotatedString.Builder.() -> Unit,
): AnnotatedString {
    val outcome = cm.m.pollResult
    val question = poll?.question
    val head = if (question != null) fill(t("chat.systemMessage.pollClosed"), mapOf("actor" to actor, "question" to { withStyle(SpanStyle(fontWeight = FontWeight(600))) { append(question) } }))
    else fill(t("chat.systemMessage.pollClosedUntitled"), mapOf("actor" to actor))
    val result = when {
        outcome == null || outcome.totalVotes == 0 -> t("chat.systemMessage.pollNoVotes")
        outcome.victorAnswerId == 0 -> t("chat.systemMessage.pollTie")
        else -> {
            val answer = poll?.answers?.getOrNull(outcome.victorAnswerId - 1)?.text ?: ""
            val pct = if (outcome.totalVotes > 0) Math.round(outcome.victorAnswerVotes * 100.0 / outcome.totalVotes) else 0
            t("chat.systemMessage.pollWinner", "answer" to answer, "percent" to pct)
        }
    }
    return buildAnnotatedString {
        append(head)
        append(" ")
        append(result)
        append(" ")
        view()
    }
}
