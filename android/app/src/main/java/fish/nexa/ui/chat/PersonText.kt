package fish.nexa.ui.chat

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Constraints
import fish.nexa.Nexa
import fish.nexa.data.NameStyle
import fish.nexa.ui.components.pressable
import kotlinx.serialization.json.JsonElement

/** Translate the person's argument as this marker, keeping the surrounding sentence in its own type. */
const val PERSON_SLOT = "\u0001"

/** Observe real measuring constraints without a subcomposed layout, so intrinsic-height text still works. */
class InlineWidth internal constructor(initial: Int) {
    var pixels by mutableIntStateOf(initial)
        private set
    val modifier: Modifier = Modifier.layout { measurable, constraints ->
        if (constraints.hasBoundedWidth && pixels != constraints.maxWidth) pixels = constraints.maxWidth
        val child = measurable.measure(constraints)
        layout(child.width, child.height) { child.placeRelative(0, 0) }
    }
}

@Composable
fun rememberInlineWidth(): InlineWidth {
    val density = LocalDensity.current
    val screenWidth = LocalConfiguration.current.screenWidthDp
    return remember(density, screenWidth) { InlineWidth(with(density) { screenWidth.dp.roundToPx() }) }
}

/** Inline identities for sentences that also contain links, dates or other formatted fragments. */
class PersonInlines internal constructor(
    private val style: TextStyle,
    private val color: Color,
    private val serverId: String?,
    private val nameStyle: JsonElement?,
    private val measure: (String?, String) -> Pair<TextUnit, TextUnit>,
) {
    val content = linkedMapOf<String, InlineTextContent>()

    fun append(to: AnnotatedString.Builder, userId: String?, name: String, onClick: (() -> Unit)? = null) {
        val key = "person:${content.size}"
        val (width, height) = measure(userId, name)
        content[key] = InlineTextContent(Placeholder(width, height, PlaceholderVerticalAlign.TextCenter)) {
            val modifier = if (onClick == null) Modifier else Modifier.pressable(remember { MutableInteractionSource() }, onClick = onClick)
            PersonName(userId, name, style, color, modifier, serverId = serverId, nameStyle = nameStyle)
        }
        to.appendInlineContent(key, name.ifEmpty { " " })
    }
}

@Composable
fun personInlines(style: TextStyle, color: Color, maxWidth: Dp, serverId: String? = null, nameStyle: JsonElement? = null): PersonInlines {
    val users by Nexa.users.byId.collectAsState()
    val me by Nexa.users.me.collectAsState()
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    return PersonInlines(style, color, serverId, nameStyle) { id, name ->
        val own = NameStyle.read(when {
            id != null && id == me?.id -> me?.nameStyle
            users.containsKey(id) -> users[id]?.nameStyle
            else -> nameStyle
        })
        val measured = measurer.measure(name, nameTextStyle(style, own), maxLines = 1, overflow = TextOverflow.Ellipsis, constraints = Constraints(maxWidth = with(density) { maxWidth.roundToPx().coerceAtLeast(1) }))
        with(density) { measured.size.width.coerceAtLeast(1).toSp() to measured.size.height.coerceAtLeast(1).toSp() }
    }
}

/** A translated sentence with an identity fragment rendered by the same name renderer as a row. */
@Composable
fun PersonText(
    userId: String?,
    text: String,
    name: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    serverId: String? = null,
    nameStyle: JsonElement? = null,
    nameTextStyle: TextStyle = style,
) {
    if (!text.contains(PERSON_SLOT)) {
        BasicText(text, modifier, style.copy(color = color), maxLines = maxLines,
            overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis)
        return
    }
    PersonLine(style, color, modifier, maxLines, serverId, nameStyle, nameTextStyle = nameTextStyle) { names ->
        buildAnnotatedString {
            text.split(PERSON_SLOT).forEachIndexed { i, part ->
                if (i > 0) names.append(this, userId, name)
                append(part)
            }
        }
    }
}

/** Names reserve at most the line's actual width; the renderer ellipsizes inside that slot. */
@Composable
fun PersonLine(
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    serverId: String? = null,
    nameStyle: JsonElement? = null,
    nameTextStyle: TextStyle = style,
    nameColor: Color = color,
    text: @Composable (PersonInlines) -> AnnotatedString,
) {
    val width = rememberInlineWidth()
    val maxWidth = with(LocalDensity.current) { width.pixels.toDp() }
    Box(modifier.then(width.modifier)) {
        val names = personInlines(nameTextStyle, nameColor, maxWidth, serverId, nameStyle)
        val words = text(names)
        BasicText(words, style = style.copy(color = color), inlineContent = names.content, maxLines = maxLines,
            overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis)
    }
}

/** A sentence's visible identities, with control-character slots preserving translation order. */
data class PersonWords(val text: String, val people: List<Pair<String?, String>>, val serverId: String? = null)

@Composable
fun PersonWordsText(words: PersonWords, style: TextStyle, color: Color, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    PersonLine(style, color, modifier, maxLines, words.serverId) { names ->
        buildAnnotatedString {
            var start = 0
            words.text.forEachIndexed { index, ch ->
                val slot = if (ch.code in 1..31) ch.code - 1 else if (ch.code in 0xE000..0xF8FF) ch.code - 0xE000 else -1
                val person = words.people.getOrNull(slot)
                if (person != null) {
                    append(words.text.substring(start, index))
                    names.append(this, person.first, person.second)
                    start = index + 1
                }
            }
            append(words.text.substring(start))
        }
    }
}

@Composable
fun PersonHeading(words: PersonWords) {
    PersonWordsText(words, fish.nexa.ui.theme.Nx.type.heading.copy(fontSize = fish.nexa.ui.theme.Nx.type.sp(21f), fontWeight = androidx.compose.ui.text.font.FontWeight(680), lineHeight = fish.nexa.ui.theme.Nx.type.sp(25.2f)), fish.nexa.ui.theme.Nx.colors.textStrong,
        Modifier.semantics { heading() })
}

/** A localized list can put each person in a distinct inline slot. */
fun personSlot(index: Int): String = (0xE000 + index).toChar().toString()
