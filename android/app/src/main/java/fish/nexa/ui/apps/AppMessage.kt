package fish.nexa.ui.apps

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.AppCommands
import fish.nexa.data.ChatMessage
import fish.nexa.data.Interactions
import fish.nexa.data.Pickables
import fish.nexa.net.InteractRequest
import fish.nexa.ui.Icon
import fish.nexa.ui.chat.ListCtx
import fish.nexa.ui.chat.ReplyFrame
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.markdown.Webhook
import fish.nexa.ui.media.HookEmojiGlyph
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * The parts of an app's message that do something or say something no other
 * message does (web components/chat/apps/AppMessage.tsx): who used what to
 * bring it, the app still thinking, the line under an answer only you see,
 * and the buttons and select menus the app answers. The rest of an app's
 * message is drawn as a webhook's is (ui/media/Webhook.kt), since it comes in
 * the same shape.
 */

/** The message whose parts are being drawn, and whether its buttons and menus can be used. */
data class AppMsg(val cm: ChatMessage, val interactive: Boolean)

val LocalAppMsg = staticCompositionLocalOf<AppMsg?> { null }

@Composable
fun AppMsgProvider(cm: ChatMessage, interactive: Boolean, content: @Composable () -> Unit) {
    val value = remember(cm, interactive) { AppMsg(cm, interactive) }
    CompositionLocalProvider(LocalAppMsg provides value, content = content)
}

/** What brought the message, when it answers a command (a form's answer counts as its command's). */
fun usedCommand(it: Webhook.Interaction?): Webhook.Interaction? {
    if (it == null) return null
    if (it.type == 2.0 && it.name != null) return it
    val trigger = it.trigger
    if (it.type == 5.0 && trigger?.type == 2.0 && trigger.name != null) return trigger.copy(userId = it.userId)
    return null
}

/**
 * The line over an app's answer to a command: who used which command. The
 * name opens their profile; the command, a slash command, starts in the
 * message box, for using it too.
 */
@Composable
fun InteractionLine(cm: ChatMessage, it: Webhook.Interaction, ctx: ListCtx) {
    val c = Nx.colors
    val name = Names.member(ctx.server?.server?.id, it.userId)
    val slash = (it.commandType ?: 1.0) == 1.0
    val command = if (slash) "/${it.name}" else it.name ?: ""
    val appId = Webhook.of(cm.hook)?.applicationId
    val nameStyle = TextLinkStyles(SpanStyle(color = c.text, fontWeight = FontWeight(500)))
    val commandStyle = SpanStyle(color = c.textBrand, fontWeight = FontWeight(650))
    val line = buildAnnotatedString {
        val template = t("apps.used")
        var i = 0
        for (m in Regex("\\{(\\w+)\\}").findAll(template)) {
            append(template.substring(i, m.range.first))
            when (m.groupValues[1]) {
                "name" -> withLink(LinkAnnotation.Clickable("user-${it.userId}", styles = nameStyle) { _ -> openProfile(it.userId) }) { append(name) }
                "command" ->
                    if (slash && appId != null && it.name != null) withLink(
                        LinkAnnotation.Clickable("command", styles = TextLinkStyles(commandStyle)) { _ ->
                            AppCommands.startCommand(AppCommands.Start(cm.channelId, appId, it.name))
                        },
                    ) { append(command) }
                    else withStyle(commandStyle) { append(command) }
                else -> append(m.value)
            }
            i = m.range.last + 1
        }
        append(template.substring(i))
    }
    ReplyFrame {
        Avatar(it.userId, name, Nexa.users.get(it.userId)?.avatarId, 16.dp)
        BasicText(line, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), color = c.textMuted), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
    }
}

/** An answer the app is still thinking about: it said it would answer, and has not yet. */
@Composable
fun Thinking(cm: ChatMessage) {
    val c = Nx.colors
    val app = Interactions.appName(cm.authorId)
    Row(
        Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ThinkingDots(c.textMuted)
        Txt(t("apps.thinking", "app" to app), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.textMuted)
    }
}

/** The three dots of an answer on its way, breathing in turn (still when motion is reduced). */
@Composable
private fun ThinkingDots(color: androidx.compose.ui.graphics.Color) {
    val reduced = Nx.motion.reduced
    val inf = rememberInfiniteTransition(label = "thinking")
    val p by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Restart), label = "p")
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until 3) {
            val phase = ((p * 1200 - i * 150 + 1200) % 1200) / 1200f
            val on = if (reduced) 0.6f else if (phase < 0.4f) phase / 0.4f else if (phase < 0.8f) 1f - (phase - 0.4f) / 0.4f else 0f
            Box(Modifier.size(6.dp).scale(0.8f + 0.2f * on).alpha(0.3f + 0.7f * on).background(color, CircleShape))
        }
    }
}

/** Under an answer only this person sees: that only they see it, and the way to put it away. */
@Composable
fun OnlyYou(cm: ChatMessage) {
    val c = Nx.colors
    Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon("Eye", c.textBrand, size = 14.dp)
        Txt(t("apps.onlyYou"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), lineHeight = Nx.type.sp(16f)), color = c.textMuted)
        Txt(
            t("apps.dismissMessage"),
            style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), lineHeight = Nx.type.sp(16f), fontWeight = FontWeight(550)),
            color = c.link,
            modifier = Modifier.pressable(remember { MutableInteractionSource() }) { Interactions.dismiss(cm) }.padding(horizontal = 4.dp, vertical = 10.dp),
        )
    }
}

/** A button on an app's message, which the app answers when pressed. */
@Composable
fun AppButton(b: Webhook.Component) {
    val app = LocalAppMsg.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val usable = app?.interactive == true && b.customId != null && b.style != Webhook.BUTTON_PREMIUM.toDouble() && !b.disabled
    val kind = when (b.style) {
        Webhook.BUTTON_PRIMARY.toDouble() -> ButtonKind.PRIMARY
        Webhook.BUTTON_SUCCESS.toDouble() -> ButtonKind.POSITIVE
        Webhook.BUTTON_DANGER.toDouble() -> ButtonKind.DANGER
        else -> ButtonKind.SECONDARY
    }
    NxButton(
        b.label ?: "",
        onClick = {
            val a = app ?: return@NxButton
            val appId = Webhook.of(a.cm.hook)?.applicationId ?: return@NxButton
            if (!usable || busy) return@NxButton
            busy = true
            scope.launch {
                Interactions.interact(InteractRequest(3, appId, a.cm.channelId, a.cm.id, data = buildJsonObject {
                    put("custom_id", b.customId)
                    put("component_type", 2)
                }))
                busy = false
            }
        },
        modifier = Modifier.widthIn(min = 60.dp),
        kind = kind,
        size = ButtonSize.TOUCH,
        enabled = usable,
        loading = busy,
        leading = b.emoji?.let { e -> { HookEmojiGlyph(e, 18) } },
    )
}

/**
 * A select menu on an app's message. Picking sends what was picked to the
 * app: at once for a menu that takes one, when the sheet closes for one that
 * takes several (if what is picked is within what it asks for).
 */
@Composable
fun AppSelect(comp: Webhook.Component) {
    val app = LocalAppMsg.current
    val scope = rememberCoroutineScope()
    val channelId = app?.cm?.channelId ?: ""
    val initial = remember(comp) {
        if (comp.isType(Webhook.C_STRING_SELECT)) comp.options.filter { it.default }.map { it.value } else comp.defaultValues.map { it.id }
    }
    var picked by remember(initial) { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    val kind = entityKindOfComponent(comp.type.toInt().takeIf { it.toDouble() == comp.type } ?: 0)
    val min = (comp.minValues ?: 1.0).toInt()
    val max = maxOf(min, (comp.maxValues ?: 1.0).toInt())
    val usable = app?.interactive == true && comp.customId != null && !comp.disabled
    val channelTypes = comp.channelTypes?.map { it.toInt() }
    SelectBox(
        placeholder = comp.placeholder ?: t("apps.select.placeholder"),
        title = comp.placeholder ?: t("apps.select.title"),
        picked = picked,
        labelOf = { v -> if (kind != null) Pickables.label(channelId, v) else comp.options.firstOrNull { it.value == v }?.label ?: v },
        choicesFor = { q ->
            if (kind != null) entityChoices(kind, channelId, q, channelTypes)
            else comp.options.filter { q.isEmpty() || it.label.lowercase().contains(q.lowercase()) }.map { Choice(it.value, it.label, it.description, it.emoji) }
        },
        min = min,
        max = max,
        enabled = usable,
        busy = busy,
        searchable = kind != null || comp.options.size > 8,
        onSearch = if (kind != null) { q -> Pickables.findMembers(channelId, q) } else null,
        onCommit = { values ->
            val a = app ?: return@SelectBox
            val appId = Webhook.of(a.cm.hook)?.applicationId ?: return@SelectBox
            picked = values
            busy = true
            scope.launch {
                Interactions.interact(InteractRequest(3, appId, a.cm.channelId, a.cm.id, data = buildJsonObject {
                    put("custom_id", comp.customId)
                    put("component_type", comp.type.toInt())
                    put("values", JsonArray(values.map { JsonPrimitive(it) }))
                }))
                busy = false
            }
        },
    )
}
