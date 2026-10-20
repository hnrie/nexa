package fish.nexa.ui.apps

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.data.Pickables
import fish.nexa.net.PublicUser
import fish.nexa.net.Role as ServerRole
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.LoadingDots
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.markdown.Webhook
import fish.nexa.ui.media.HookEmojiGlyph
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.delay

/** One thing a select box offers; `picture` is a person's picture or a role's colour, drawn before the label. */
data class Choice(
    val value: String,
    val label: String,
    val description: String? = null,
    val emoji: Webhook.Emoji? = null,
    val picture: (@Composable () -> Unit)? = null,
)

/**
 * A box that opens a list to pick from (web components/apps/SelectBox.tsx):
 * what an app's select menu is, on its message and in its forms. It looks like
 * a text box (a well), and its list is a sheet, with a search for long lists
 * and for people, roles and channels. One that takes a single value gives it
 * the moment it is picked; one that takes several gives them all when the
 * sheet closes, if there are as many as it asks for.
 */
@Composable
fun SelectBox(
    placeholder: String,
    picked: List<String>,
    labelOf: (String) -> String,
    choicesFor: (String) -> List<Choice>,
    modifier: Modifier = Modifier,
    min: Int = 1,
    max: Int = 1,
    enabled: Boolean = true,
    busy: Boolean = false,
    searchable: Boolean = false,
    /** Told what is typed, for lists that look further afield (a big server's members). */
    onSearch: (suspend (String) -> Unit)? = null,
    invalid: Boolean = false,
    /** The sheet's title: an app's own placeholder serves, words of Nexa's own pass a title in Title Case. */
    title: String = placeholder,
    onCommit: (List<String>) -> Unit,
) {
    val c = Nx.colors
    val shown = picked.joinToString(", ") { labelOf(it) }
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .sunken(Radii.Sm, c)
            .border(1.dp, if (invalid) c.danger else c.borderSubtle, Radii.Sm)
            .clip(Radii.Sm)
            .pressable(interaction, enabled = enabled && !busy, role = Role.DropdownList) {
                openSelectSheet(title, picked, choicesFor, min, max, searchable, onSearch, onCommit)
            }
            .semantics { contentDescription = if (shown.isEmpty()) placeholder else "$placeholder: $shown" }
            .padding(start = 12.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Txt(
            shown.ifEmpty { placeholder },
            style = Nx.type.input.copy(fontSize = Nx.type.sp(15f)),
            color = if (shown.isEmpty()) c.textPlaceholder else c.text,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        if (busy) LoadingDots(c.textMuted) else Icon("ChevronDown", c.textMuted, size = 18.dp)
    }
}

private fun openSelectSheet(
    title: String,
    picked: List<String>,
    choicesFor: (String) -> List<Choice>,
    min: Int,
    max: Int,
    searchable: Boolean,
    onSearch: (suspend (String) -> Unit)?,
    onCommit: (List<String>) -> Unit,
) {
    val multi = max > 1
    openSheet("app-select", title = title) { close ->
        val c = Nx.colors
        var query by remember { mutableStateOf("") }
        var draft by remember { mutableStateOf(picked) }
        // a search further afield brings more in: the list is read again once it has
        var found by remember { mutableIntStateOf(0) }
        LaunchedEffect(query) {
            if (onSearch == null) return@LaunchedEffect
            delay(200)
            onSearch(query)
            found++
        }
        // several picked go when the sheet does, if there are as many as it asks for
        DisposableEffect(Unit) {
            onDispose {
                if (multi && draft != picked && draft.size in min..max) onCommit(draft)
            }
        }
        @Suppress("UNUSED_EXPRESSION") found
        val choices = choicesFor(query)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (searchable) NxTextField(
                query, { query = it },
                placeholder = t("apps.select.search"),
                leading = { Icon("Search", c.textMuted, size = 16.dp) },
            )
            if (choices.isEmpty()) Txt(t("apps.select.nothing"), style = Nx.type.bodySmall, color = c.textMuted, modifier = Modifier.padding(horizontal = 4.dp, vertical = 12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (o in choices) {
                    val on = o.value in (if (multi) draft else picked)
                    ChoiceRow(o, on, multi) {
                        if (!multi) {
                            close()
                            onCommit(listOf(o.value))
                        } else {
                            draft = if (on) draft - o.value else if (draft.size >= max) draft else draft + o.value
                        }
                    }
                }
            }
            if (multi) Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Txt(
                    when {
                        min == max -> t("apps.select.pickExactly", "count" to max)
                        min == 0 -> t("apps.select.pickUpTo", "count" to max)
                        else -> t("apps.select.pickBetween", "min" to min, "max" to max)
                    },
                    style = Nx.type.hint, color = c.textMuted, modifier = Modifier.weight(1f),
                )
                Txt(t("apps.select.picked", "count" to draft.size), style = Nx.type.hint.copy(fontWeight = FontWeight(650)), color = c.textSubtle)
            }
        }
    }
}

@Composable
private fun ChoiceRow(o: Choice, on: Boolean, multi: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgActive else if (on) c.bgSelected else Color.Transparent)
            .pressable(interaction, role = if (multi) Role.Checkbox else Role.RadioButton, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (o.picture != null) o.picture.invoke() else if (o.emoji != null) HookEmojiGlyph(o.emoji, 22)
        Column(Modifier.weight(1f)) {
            Txt(o.label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(550)), color = if (on) c.textStrong else c.text, maxLines = 2)
            if (o.description != null) Txt(o.description, style = Nx.type.hint, color = c.textMuted, maxLines = 2)
        }
        if (multi) {
            Box(
                Modifier
                    .size(20.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (on) c.brand else Color.Transparent)
                    .border(2.dp, if (on) c.brand else c.borderStrong, RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) { if (on) Icon("Check", c.onBrand, size = 14.dp) }
        } else if (on) Icon("Check", c.textBrand, size = 18.dp)
    }
}

/** What an app can ask someone to pick: people, roles, both, or channels. */
enum class EntityKind { USER, ROLE, MENTIONABLE, CHANNEL }

/** The kind of entity a select component (5 to 8) asks for. */
fun entityKindOfComponent(type: Int): EntityKind? = when (type) {
    5 -> EntityKind.USER
    6 -> EntityKind.ROLE
    7 -> EntityKind.MENTIONABLE
    8 -> EntityKind.CHANNEL
    else -> null
}

/** The people, roles or channels of where something was used, as choices, for what was typed. */
fun entityChoices(kind: EntityKind, channelId: String, query: String, channelTypes: List<Int>? = null): List<Choice> {
    val out = ArrayList<Choice>()
    if (kind == EntityKind.USER || kind == EntityKind.MENTIONABLE) {
        for (u in Pickables.people(channelId, query)) out += personChoice(u)
    }
    if (kind == EntityKind.ROLE || kind == EntityKind.MENTIONABLE) {
        for (r in Pickables.roles(channelId, query)) out += roleChoice(r)
    }
    if (kind == EntityKind.CHANNEL) {
        for (ch in Pickables.channels(channelId, query, channelTypes)) out += Choice(ch.id, ch.name, picture = { Icon("Hash", Nx.colors.icon, size = 18.dp) })
    }
    return out
}

private fun personChoice(u: PublicUser) = Choice(u.id, u.name, description = u.username, picture = { Avatar(u.id, u.name, u.avatarId, 24.dp) })

private fun roleChoice(r: ServerRole) = Choice(r.id, r.name, picture = {
    Box(Modifier.padding(horizontal = 6.dp).size(12.dp).background(if (r.color != 0L) rgbColor(r.color) else Nx.colors.textMuted, CircleShape))
})
