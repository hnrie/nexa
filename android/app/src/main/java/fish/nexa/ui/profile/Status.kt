package fish.nexa.ui.profile

import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.media.Media
import fish.nexa.media.TwemojiImage
import fish.nexa.net.Activity
import fish.nexa.net.Presence
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlin.math.roundToInt

/** stores/presence.ts: what of someone's presence others can see (nothing while offline or invisible). */
object Presences {
    private fun shown(p: Presence?) = p != null && p.status != "offline" && p.status != "invisible"

    data class Custom(val text: String, val emoji: String)

    fun customStatus(p: Presence?): Custom? {
        if (!shown(p)) return null
        if (p!!.statusExpiresAt != null && p.statusExpiresAt < System.currentTimeMillis()) return null
        if (p.statusText.isEmpty() && p.statusEmoji.isEmpty()) return null
        return Custom(p.statusText, p.statusEmoji)
    }

    fun activitiesOf(p: Presence?): List<Activity> = if (shown(p)) p!!.activities ?: emptyList() else emptyList()

    fun of(userId: String?): Presence? = userId?.let { Nexa.presence.byId.value[it] }
}

/** lib/activity.ts: how an activity is named and timed. */
object Activities {
    fun isSpotify(a: Activity) = a.type == 2 && a.name.trim().lowercase() == "spotify"

    /** The name a status line shows: the state or details when the activity asks for them. */
    fun shownName(a: Activity): String {
        val shown = a.statusDisplayType ?: if (isSpotify(a)) 1 else 0
        val text = when (shown) {
            1 -> a.state
            2 -> a.details
            else -> null
        }
        return text?.takeIf { it.isNotEmpty() } ?: a.name
    }

    private fun lineFor(type: Int, name: String) = when (type) {
        1 -> t("activity.streamingName", "name" to name)
        2 -> t("activity.listeningToName", "name" to name)
        3 -> t("activity.watchingName", "name" to name)
        5 -> t("activity.competingInName", "name" to name)
        else -> t("activity.playingName", "name" to name)
    }

    fun line(a: Activity) = lineFor(a.type, shownName(a))

    fun heading(a: Activity) = if (a.type == 0) t("activity.statusLine.playingAGame") else lineFor(a.type, a.name)

    fun icon(type: Int) = when (type) {
        1 -> "Radio"
        2 -> "Music"
        3 -> "Tv"
        5 -> "Trophy"
        else -> "Gamepad2"
    }

    fun label(type: Int) = when (type) {
        0 -> t("activity.statusLine.playingAGame")
        1 -> t("activity.statusLine.streaming")
        2 -> t("activity.statusLine.listeningToMusic")
        3 -> t("activity.statusLine.watching")
        5 -> t("activity.statusLine.competing")
        else -> t("settings.privacy.activity")
    }

    /** --activity-green: games and music. */
    fun green(light: Boolean): Color = if (light) Color(0xFF117A37) else Color(0xFF1ED760)

    sealed interface Clock {
        data class Progress(val elapsed: Long, val total: Long, val fraction: Float) : Clock
        data class Elapsed(val elapsed: Long) : Clock
        data class Remaining(val remaining: Long) : Clock
    }

    fun progress(a: Activity, now: Long): Clock? {
        val start = a.timestamps?.start
        val end = a.timestamps?.end
        if (start != null && end != null && end > start && (a.type == 2 || a.type == 3)) {
            val total = end - start
            val elapsed = minOf(total, maxOf(0, now - start))
            return Clock.Progress(elapsed, total, elapsed.toFloat() / total)
        }
        if (start != null) return Clock.Elapsed(maxOf(0, now - start))
        if (end != null) return Clock.Remaining(maxOf(0, end - now))
        return null
    }

    fun clock(ms: Long): String {
        val total = maxOf(0, ms / 1000)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = (total % 60).toString().padStart(2, '0')
        return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$s" else "$m:$s"
    }
}

/** ActivityIcon: the kind of activity at 12 dp, green for games and music, "+N" when there are more. */
@Composable
fun ActivityIcon(a: Activity, more: Int = 0, size: androidx.compose.ui.unit.Dp = 12.dp) {
    val c = Nx.colors
    val green = a.type == 0 || a.type == 2 || Activities.isSpotify(a)
    val tint = if (green) Activities.green(c.isLight) else c.textMuted.copy(alpha = 0.85f)
    val label = Activities.label(a.type)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(1.dp),
        modifier = Modifier.semantics { contentDescription = if (more > 0) t("activity.statusLine.andMore", "what" to label, "count" to more) else label },
    ) {
        Icon(Activities.icon(a.type), tint, size = size)
        if (more > 0) Txt("+$more", style = Nx.type.hint.copy(fontSize = Nx.type.sp(10f), fontWeight = FontWeight(700)), color = c.textMuted)
    }
}

/** A custom emoji as a status carries it: the token a message writes it as (`<:name:id>`, `<a:name:id>` when it moves). */
private val CUSTOM_STATUS_EMOJI = Regex("^<(a?):(\\w+):(\\d+)>$")

/** A status's emoji as words, for what reads the screen aloud: a custom one by its :name: (StatusEmoji.tsx statusEmojiText). */
fun statusEmojiText(emoji: String): String = CUSTOM_STATUS_EMOJI.matchEntire(emoji)?.let { ":" + it.groupValues[2] + ":" } ?: emoji

/** A status's emoji: a standard one drawn as Twemoji, a server's or a pack's own as its picture (StatusEmoji.tsx). */
@Composable
fun StatusEmojiImage(emoji: String, size: Dp, modifier: Modifier = Modifier) {
    val m = CUSTOM_STATUS_EMOJI.matchEntire(emoji)
    if (m == null) {
        TwemojiImage(emoji, size, modifier)
        return
    }
    val density = LocalDensity.current.density
    AsyncImage(
        Media.emojiUrl(m.groupValues[3], size.value.roundToInt(), density, still = m.groupValues[1] != "a"), ":" + m.groupValues[2] + ":",
        imageLoader = Media.loader, contentScale = ContentScale.Fit, modifier = modifier.size(size),
    )
}

/**
 * StatusLine: under a name, the custom status (its emoji in Twemoji and its
 * words), or else the first activity's name in bold beside its kind; running
 * as a marquee when it does not fit (still with reduced motion).
 */
@Composable
fun StatusLine(userId: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    val all by Nexa.presence.byId.collectAsState()
    val p = all[userId]
    val custom = Presences.customStatus(p)
    val acts = Presences.activitiesOf(p)
    val act = acts.firstOrNull()
    if (custom == null && act == null) return
    val c = Nx.colors
    val reduced = Nx.motion.reduced
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        if (act != null) ActivityIcon(act, more = maxOf(0, acts.size - 1))
        val text = buildAnnotatedString {
            if (custom != null && (custom.text.isNotEmpty() || custom.emoji.isNotEmpty())) {
                if (custom.emoji.isNotEmpty()) {
                    appendInlineContent("emoji", statusEmojiText(custom.emoji))
                    append(" ")
                }
                append(custom.text)
            } else if (act != null) {
                withStyle(SpanStyle(fontWeight = FontWeight(600), color = c.textSubtle)) { append(Activities.shownName(act)) }
            }
        }
        val inline = if (custom?.emoji?.isNotEmpty() == true) mapOf(
            "emoji" to InlineTextContent(Placeholder(1.15.em, 1.15.em, PlaceholderVerticalAlign.Center)) { StatusEmojiImage(custom.emoji, (style.fontSize.value * 1.15f).dp) },
        ) else emptyMap()
        BasicText(
            text,
            Modifier.then(if (reduced) Modifier else Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 1500, repeatDelayMillis = 2000)),
            style = style.copy(color = color),
            maxLines = 1,
            inlineContent = inline,
        )
    }
}

/** Whether someone has anything for a status line to show. */
fun hasStatusLine(userId: String): Boolean {
    val p = Nexa.presence.byId.value[userId]
    return Presences.customStatus(p) != null || Presences.activitiesOf(p).isNotEmpty()
}
