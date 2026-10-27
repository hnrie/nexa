package fish.nexa.ui.dialogs

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Ids
import fish.nexa.data.People
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.ServerIcon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.profile.dmOpenError
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.launch
import java.text.Normalizer

/** Where the Quick Switcher can take you. */
private data class Place(
    val id: String,
    val kind: String,
    val label: String,
    val sub: String,
    val avatarId: String?,
    val avatarKey: String,
    /** Newer conversations first, when nothing is typed. */
    val last: String?,
    val go: () -> Unit,
)

/** Lower case without accents, for comparing names as people type them. */
private fun fold(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

/** How well a name matches what was typed: whole, its start, a word's start, inside it, or its letters in order. */
private fun score(hay: String, q: String): Int {
    val h = fold(hay)
    if (h == q) return 100
    if (h.startsWith(q)) return 80
    if (h.split(Regex("[\\s._-]+")).any { it.startsWith(q) }) return 60
    if (h.contains(q)) return 50
    var qi = 0
    for (ch in h) if (qi < q.length && ch == q[qi]) qi++
    return if (qi == q.length) 20 else -1
}

private fun places(close: () -> Unit): List<Place> {
    val me = Nexa.users.meId
    val out = ArrayList<Place>()
    fun go(r: Route): () -> Unit = {
        close()
        Nav.go(r)
        Nav.leftOpen = false
    }
    val withDm = HashSet<String>()
    for (ch in Nexa.channels.byId.value.values) {
        if (ch.type == "dm") {
            val other = ch.recipientIds.firstOrNull { it != me } ?: ""
            withDm += other
            val u = Nexa.users.get(other)
            out += Place(ch.id, "dm", Names.channel(ch), "@" + (u?.username ?: ""), u?.avatarId, other, ch.lastMessageId ?: ch.id, go(Route.Dm(ch.id)))
        } else if (ch.type == "group_dm") {
            out += Place(ch.id, "group", Names.channel(ch), t("chat.chatView.membersCount", "count" to ch.recipientIds.size), ch.iconId, ch.id, ch.lastMessageId ?: ch.id, go(Route.Dm(ch.id)))
        }
    }
    for (r in Nexa.relationships.byId.value.values) {
        if (r.type != "friend" || r.user.id in withDm) continue
        out += Place("u" + r.user.id, "friend", r.nickname.ifBlank { Names.display(r.user) }, "@" + r.user.username, r.user.avatarId, r.user.id, null) {
            close()
            Nexa.scope.launch {
                try {
                    val ch = People.openDm(r.user.id)
                    Nav.go(Route.Dm(ch.id))
                    Nav.leftOpen = false
                } catch (e: Exception) {
                    Nexa.ui.toast(dmOpenError(e, t("modals.quickSwitcher.couldNotOpenTheConversation")), "error")
                }
            }
        }
    }
    for (st in Nexa.servers.byId.value.values) {
        val s = st.server
        out += Place("s" + s.id, "server", s.name, t("search.switcher.server"), s.iconId, s.id, null, go(Route.Server(s.id)))
        val texts = Nexa.channels.byId.value.values.filter { it.serverId == s.id && it.type == "text" }.sortedWith(compareBy({ it.position }, { it.id.length }, { it.id }))
        for (ch in texts) out += Place(ch.id, "channel", ch.name, s.name, null, ch.id, null, go(Route.Server(s.id, ch.id)))
    }
    return out
}

/**
 * Find or Start a Conversation, on a phone the whole screen: the box at the
 * top with the keyboard up, and where to go as you type (people,
 * conversations, servers, channels). With nothing typed, the latest
 * conversations.
 */
fun openQuickSwitcher() {
    lateinit var layer: Layer
    layer = Layer("quickSwitcher", replaces = "quickSwitcher") { _ -> QuickSwitcherScreen { Layers.remove(layer) } }
    Layers.open(layer)
}

@Composable
private fun QuickSwitcherScreen(close: () -> Unit) {
    val c = Nx.colors
    val channels by Nexa.channels.byId.collectAsState()
    val rels by Nexa.relationships.byId.collectAsState()
    val servers by Nexa.servers.byId.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    var q by remember { mutableStateOf("") }
    val all = remember(channels, rels, servers, users) { places(close) }
    val query = fold(q.trim().removePrefix("@").removePrefix("#"))
    val scored = remember(all, query) {
        if (query.isEmpty()) all.filter { it.kind == "dm" || it.kind == "group" }.sortedWith { a, b -> Ids.compare(b.last ?: "0", a.last ?: "0") }.take(8).map { it to 0 }
        else all.map { it to maxOf(score(it.label, query), score(it.sub.removePrefix("@"), query) - 5) }.filter { it.second >= 0 }.sortedByDescending { it.second }.take(12)
    }
    // a name typed (its start, a word's start, inside it) is where Go takes you
    val first = scored.firstOrNull()?.takeIf { query.isNotEmpty() && it.second >= 50 }?.first
    val focus = remember { FocusRequester() }
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    // straight into the box, with the keyboard up: this screen is for typing
    LaunchedEffect(Unit) {
        focus.requestFocus()
        keyboard?.show()
    }
    Box(Modifier.fillMaxSize().background(c.bgFloating).semantics { contentDescription = t("sidebar.dMSidebar.findOrStartAConversation") }) {
        Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                IconButton("ArrowLeft", t("search.panel.close"), close, size = 44.dp, iconSize = 22.dp)
                Row(
                    Modifier.weight(1f).height(48.dp).sunken(Radii.Sm, c).ring(Radii.Sm, c.borderSubtle).padding(start = 14.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon("Search", c.textMuted, size = 18.dp)
                    val style = Nx.type.input.copy(fontSize = Nx.type.sp(17f), color = c.text)
                    BasicTextField(
                        q, { q = it },
                        Modifier.weight(1f).focusRequester(focus).semantics { contentDescription = t("sidebar.dMSidebar.findOrStartAConversation") },
                        textStyle = style,
                        singleLine = true,
                        cursorBrush = SolidColor(c.focusRing),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { first?.go?.invoke() }),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (q.isEmpty()) Txt(t("android.people.switcherPlaceholder"), style = style, color = c.textPlaceholder, maxLines = 1)
                                inner()
                            }
                        },
                    )
                    if (q.isNotEmpty()) IconButton("X", t("chat.chat.clearSearch"), { q = "" }, size = 40.dp, iconSize = 18.dp, tint = c.textMuted)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
            LazyColumn(Modifier.fillMaxSize().navigationBarsPadding(), contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp)) {
                if (scored.isNotEmpty()) item(key = "head") {
                    Txt(
                        if (query.isEmpty()) t("search.suggest.conversations") else t("search.switcher.jumpTo"),
                        style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700)),
                        color = c.textMuted,
                        modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 10.dp, bottom = 4.dp).semantics { heading() },
                    )
                }
                items(scored, key = { it.first.id }) { (p, _) -> PlaceRow(p, active = p === first) }
                if (query.isNotEmpty() && scored.isEmpty()) item(key = "nothing") {
                    Txt(t("android.people.switcherNothing"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun PlaceRow(p: Place, active: Boolean) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .then(if (active) Modifier.ring(Radii.Sm, c.brand.copy(alpha = 0.26f)).background(c.brand.copy(alpha = 0.18f), Radii.Sm) else Modifier.background(if (pressed) c.bgHover else Color.Transparent, Radii.Sm))
            .clip(Radii.Sm)
            .pressable(interaction, onClick = p.go)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when {
            p.kind == "channel" -> Glyph("Hash")
            p.kind == "group" && p.avatarId == null -> Glyph("Users")
            p.kind == "server" -> if (p.avatarId != null) ServerIcon(p.avatarKey, p.label, p.avatarId, 28.dp, radius = 9.dp) else Glyph("Server")
            else -> Avatar(p.avatarKey, p.label, p.avatarId, 28.dp, icon = p.kind == "group")
        }
        fish.nexa.ui.chat.PersonName(p.avatarKey.takeIf { p.kind == "dm" || p.kind == "friend" }, p.label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f))
        Row(Modifier.widthIn(max = 180.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (p.kind == "friend") {
                Icon("UserPlus", c.textMuted, size = 14.dp)
                Txt(t("search.switcher.startConversation"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
            } else Txt(p.sub, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
        }
    }
}

@Composable
private fun Glyph(icon: String) {
    Box(Modifier.size(28.dp).background(Nx.colors.bgActive, CircleShape), contentAlignment = Alignment.Center) { Icon(icon, Nx.colors.icon, size = 18.dp) }
}
