package fish.nexa.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.data.Perms
import fish.nexa.net.Channel
import fish.nexa.media.Media
import fish.nexa.media.TwemojiImage
import fish.nexa.ui.Icon
import fish.nexa.ui.Lucide
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.CountBadge
import fish.nexa.ui.components.NexaMark
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.boxShadow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/** A selected row's look: the sheen on --bg-selected, a lit top edge, a small shadow. */
@Composable
fun Modifier.selectedRow(selected: Boolean, pressed: Boolean): Modifier {
    val c = Nx.colors
    val shape = Radii.Sm
    return when {
        selected -> this
            .boxShadow(shape, 1f, 2f, c.shadeAt(0.35f))
            .background(c.bgSelected, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
        pressed -> this.background(c.bgHover, shape)
        else -> this
    }
}

/** The 4 x 8 light on the panel's edge beside an unread row. */
@Composable
fun UnreadEdge(modifier: Modifier = Modifier) {
    Box(modifier.offset(x = (-8).dp).size(4.dp, 8.dp).background(Nx.colors.textStrong, RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)))
}

// ---------------------------------------------------------------------------
// Server channel list (ServerSidebar.tsx)

@Composable
fun ServerSidebar(serverId: String, channelId: String?) {
    val c = Nx.colors
    val servers by Nexa.servers.byId.collectAsState()
    val channels by Nexa.channels.byId.collectAsState()
    val reads by Nexa.readStates.byChannel.collectAsState()
    val doc by Nexa.settings.doc.collectAsState()
    val voices by Nexa.voiceStates.byUser.collectAsState()
    @Suppress("UNUSED_VARIABLE") val touch = reads.size + doc.size + voices.size
    val st = servers[serverId] ?: return
    val tree = remember(channels, serverId) { ChannelTree.of(serverId, channels.values) }
    val collapsed = Nexa.settings.collapsedCategories
    val density = LocalDensity.current.density
    val banner = st.server.bannerId
    val list = rememberLazyListState()
    val overBanner by remember { derivedStateOf { banner != null && list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset < 89 * density } }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(state = list, modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp)) {
            if (banner != null) item("banner") {
                AsyncImage(
                    model = Media.bannerUrl(banner, 480, density),
                    imageLoader = Media.loader,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).height(138.dp).offset(x = 0.dp).clip(RoundedCornerShape(topStart = Radii.lg, topEnd = Radii.lg)),
                )
            } else item("top") { Spacer(Modifier.height(52.dp + 12.dp)) }
            items(tree.loose, key = { it.id }) { ch -> ChannelRow(st.server.id, ch, ch.id == channelId) }
            for (cat in tree.categories) {
                val isCollapsed = cat.channel.id in collapsed
                item(cat.channel.id) { CategoryHeader(serverId, cat.channel, isCollapsed) }
                val shown = if (!isCollapsed) cat.children else cat.children.filter { ch ->
                    ch.id == channelId || (ch.isText && Unread.isUnread(Nexa.readStates.get(ch.id), ch.lastMessageId) && !Unread.isMuted(ch.id, serverId)) || (Nexa.readStates.get(ch.id)?.mentions ?: 0) > 0
                }
                items(shown, key = { it.id }) { ch -> ChannelRow(st.server.id, ch, ch.id == channelId) }
            }
            if (tree.loose.isEmpty() && tree.categories.isEmpty()) item("empty") {
                Txt(t("sidebar.serverSidebar.noChannelsYouCanSeeYet"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 24.dp))
            }
            item("bottom") { Spacer(Modifier.height(8.dp)) }
        }
        // the header: on the banner while it shows, then a plain bar
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .then(
                    if (overBanner) Modifier.background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = if (pressed) 0.7f else 0.55f), Color.Transparent)))
                    else Modifier.background(if (pressed) c.bgHover else c.bgBase).background(if (banner != null) Color.Transparent else Color.Transparent),
                )
                .pressable(interaction) { openMenu(serverMenu(serverId, fromRail = false)) }
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Txt(st.server.name, style = Nx.type.name.copy(fontWeight = FontWeight(660)), color = if (overBanner) Color.White else c.textStrong, maxLines = 1, modifier = Modifier.weight(1f))
            Icon("ChevronDown", if (overBanner) Color.White else c.textStrong, size = 18.dp)
        }
        if (!overBanner) Box(Modifier.fillMaxWidth().padding(top = 52.dp).height(1.dp).background(c.borderSubtle))
    }
}

@Composable
private fun CategoryHeader(serverId: String, cat: Channel, collapsed: Boolean) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .height(40.dp)
            .pressable(interaction, onLongClick = { openMenu(categoryMenu(serverId, cat, collapsed)) }) { toggleCollapsed(cat.id, collapsed) }
            .padding(start = 2.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(if (collapsed) "ChevronRight" else "ChevronDown", c.textMuted, size = 12.dp)
        cat.glyph?.let { ChannelGlyph(cat, 14.dp, c.textMuted, Modifier.padding(start = 2.dp, end = 4.dp)) }
        Txt(cat.name, style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), letterSpacing = androidx.compose.ui.unit.TextUnit(0.01f, androidx.compose.ui.unit.TextUnitType.Em)), color = c.textMuted, maxLines = 1)
    }
}

fun toggleCollapsed(id: String, collapsed: Boolean) {
    val now = Nexa.settings.collapsedCategories.toMutableList()
    if (collapsed) now.remove(id) else now += id
    Nexa.settings.set("collapsedCategories", JsonArray(now.map { JsonPrimitive(it) }))
}

private fun categoryMenu(serverId: String, cat: Channel, collapsed: Boolean): List<MenuItem> {
    val st = Nexa.servers.get(serverId)
    val items = ArrayList<MenuItem>()
    items += MenuItem.Action(if (collapsed) t("sidebar.serverMenu.expandCategory") else t("sidebar.serverMenu.collapseCategory"), separatorAfter = true) { toggleCollapsed(cat.id, collapsed) }
    if (Nexa.servers.canI(st, P.MANAGE_CHANNELS)) {
        items += MenuItem.Action(t("modals.createChannel.createChannel")) { openCreateChannel(serverId, cat.id) }
        items += MenuItem.Action(t("sidebar.serverMenu.editCategory")) { openChannelSettings(cat.id) }
        items += MenuItem.Action(t("sidebar.serverMenu.deleteCategory"), danger = true) { confirmDeleteChannel(cat) }
    }
    if (Nexa.settings.developerMode) items += MenuItem.Action(t("sidebar.serverMenu.copyCategoryId")) { copyText(cat.id) }
    return items
}

/** ChannelGlyph.tsx: the channel's own icon (lucide, emoji or custom emoji), else # or the speaker; a lock on private text channels. */
@Composable
fun ChannelGlyph(ch: Channel, size: androidx.compose.ui.unit.Dp, tint: Color, modifier: Modifier = Modifier, cut: Color = Nx.colors.bgBase) {
    val g = ch.glyph
    val icon = g?.removePrefix("icon:")?.takeIf { g.startsWith("icon:") }?.let { CHANNEL_ICONS[it] ?: it }?.takeIf { Lucide.exists(it) }
    val emoji = g?.removePrefix("emoji:")?.takeIf { g.startsWith("emoji:") }
    val custom = g?.removePrefix("custom:")?.takeIf { g.startsWith("custom:") }?.let { Nexa.expressions.emoji(it) }
    val st = ch.serverId?.let { Nexa.servers.get(it) }
    val private = st != null && ch.type != "voice" && Perms.isPrivateChannel(st.server.id, ch.overwrites)
    val voiceOwn = ch.isVoice && (icon != null || emoji != null || custom != null)
    val density = LocalDensity.current.density
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        when {
            icon != null -> Icon(icon, tint, size = size)
            emoji != null -> TwemojiImage(emoji, size * 0.86f)
            custom != null -> AsyncImage(Media.emojiUrl(custom.blobId, (size.value * 0.86f).toInt(), density), null, Media.loader, modifier = Modifier.size(size * 0.86f))
            ch.isVoice -> Icon("Volume2", tint, size = size)
            ch.isText -> Icon("Hash", tint, size = size)
        }
        if (private || voiceOwn) {
            val badge = maxOf(9f, (size.value / 2)).dp
            Box(Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 2.dp).background(cut, RoundedCornerShape(2.dp))) {
                Icon(if (private) "Lock" else "Volume2", tint, size = badge, stroke = 2.5f)
            }
        }
    }
}

/** CHANNEL_ICONS: the stored name to its lucide icon. */
val CHANNEL_ICONS = mapOf(
    "chat" to "MessageSquare", "discussion" to "MessagesSquare", "megaphone" to "Megaphone", "newspaper" to "Newspaper",
    "welcome" to "Hand", "rules" to "ScrollText", "help" to "CircleHelp", "ideas" to "Lightbulb", "events" to "CalendarDays",
    "gift" to "Gift", "party" to "PartyPopper", "trophy" to "Trophy", "people" to "Users", "crown" to "Crown", "shield" to "Shield",
    "lock" to "Lock", "code" to "Code", "terminal" to "Terminal", "bug" to "Bug", "tools" to "Wrench", "rocket" to "Rocket",
    "bot" to "Bot", "link" to "Link", "image" to "Image", "camera" to "Camera", "art" to "Palette", "video" to "Video", "film" to "Film",
    "tv" to "Tv", "music" to "Music", "headphones" to "Headphones", "mic" to "Mic", "gamepad" to "Gamepad2", "laugh" to "Laugh",
    "book" to "BookOpen", "study" to "GraduationCap", "coffee" to "Coffee", "food" to "Pizza", "globe" to "Globe", "travel" to "Plane",
    "nature" to "Leaf", "pets" to "PawPrint", "fitness" to "Dumbbell", "heart" to "Heart", "star" to "Star", "sparkles" to "Sparkles",
    "flame" to "Flame",
)

@Composable
private fun ChannelRow(serverId: String, ch: Channel, selected: Boolean) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val read = Nexa.readStates.get(ch.id)
    val muted = Unread.isMuted(ch.id, serverId)
    val unread = ch.isText && !selected && Unread.isUnread(read, ch.lastMessageId) && !muted
    val mentions = read?.mentions ?: 0
    val people = if (ch.isVoice) Nexa.voiceStates.inChannel(ch.id) else emptyList()
    Column {
        Box(Modifier.fillMaxWidth().padding(vertical = 2.dp).alpha(if (ch.id in Unread.mutedIds()) 0.6f else 1f)) {
            if (unread) UnreadEdge(Modifier.align(Alignment.CenterStart))
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(40.dp)
                    .selectedRow(selected, pressed)
                    .pressable(interaction, onLongClick = { openMenu(channelMenu(serverId, ch)) }) {
                        if (ch.isVoice) {
                            Nav.go(Route.Server(serverId, ch.id))
                            joinVoice(ch.id)
                        } else Nav.go(Route.Server(serverId, ch.id))
                    }
                    .padding(start = 8.dp, end = 4.dp)
                    .semantics {
                        contentDescription = ch.name + when {
                            mentions > 0 -> ", " + t("sidebar.serverSidebar.mentionsCount", "count" to mentions)
                            unread -> ", " + t("sidebar.serverSidebar.unread")
                            else -> ""
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                ChannelGlyph(ch, 20.dp, if (selected) c.textBrand else c.textMuted, cut = if (selected) c.bgBase else c.bgBase)
                Txt(
                    ch.name,
                    style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)),
                    color = when {
                        selected || unread -> c.textStrong
                        pressed -> c.text
                        else -> c.textChannel
                    },
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                if (ch.isVoice && ch.userLimit > 0) Txt("${people.size}/${ch.userLimit}", style = Nx.type.hint, color = c.textMuted)
                if (mentions > 0) CountBadge(mentions, Modifier.padding(start = 4.dp))
            }
        }
        if (people.isNotEmpty()) {
            Column(Modifier.padding(start = 22.dp, bottom = 4.dp)) {
                for (v in people) VoiceParticipantRow(serverId, v)
            }
        }
    }
}

@Composable
private fun VoiceParticipantRow(serverId: String, v: fish.nexa.net.VoiceState) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val guest = v.guest != null || ((v.user?.flags ?: 0L) and 8L) != 0L
    val name = if (guest) v.user?.displayName ?: "" else Names.member(serverId, v.userId)
    Row(
        Modifier
            .fillMaxWidth()
            .height(32.dp)
            .background(if (pressed) c.bgHover else Color.Transparent, Radii.Sm)
            .pressable(interaction, onLongClick = { v.channelId?.let { ch -> openMenu(fish.nexa.ui.voice.voicePersonMenu(v.userId, ch), title = name) } }) { if (!guest) openProfile(v.userId) }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val speaking = fish.nexa.voice.Speaking.isSpeaking(v.userId)
        Avatar(v.userId, name, v.user?.avatarId ?: Nexa.users.get(v.userId)?.avatarId, 24.dp, speaking = speaking)
        Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textChannel, maxLines = 1, modifier = Modifier.weight(1f))
        if (guest) Box(Modifier.background(c.bgActive, RoundedCornerShape(3.dp)).padding(horizontal = 4.dp)) {
            Txt(t("voice.voiceParticipants.guest").uppercase(), style = Nx.type.hint.copy(fontSize = Nx.type.sp(10f), fontWeight = FontWeight(700)), color = c.textMuted)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (v.video) Icon("Video", c.textMuted, size = 14.dp)
            if (v.streaming) Icon("MonitorUp", c.textMuted, size = 14.dp)
            if (v.selfMute || v.serverMute) Icon("MicOff", if (v.serverMute) c.danger else c.textMuted, size = 14.dp)
            if (v.selfDeaf || v.serverDeaf) Icon("HeadphoneOff", if (v.serverDeaf) c.danger else c.textMuted, size = 14.dp)
        }
    }
}

private fun channelMenu(serverId: String, ch: Channel): List<MenuItem> {
    val st = Nexa.servers.get(serverId)
    val items = ArrayList<MenuItem>()
    if (ch.isText) items += MenuItem.Action(t("sidebar.dmMenu.markAsRead"), disabled = ch.lastMessageId == null, separatorAfter = true) { Unread.markRead(ch.id) }
    if (Nexa.servers.canI(st, P.CREATE_INSTANT_INVITE, ch.id)) items += MenuItem.Action(t("chat.chat.invitePeople")) { openInvite(serverId, ch.id) }
    items += MenuItem.Action(t("sidebar.serverMenu.copyLink"), separatorAfter = true) { copyText("${Nexa.api.baseUrl}/channels/$serverId/${ch.id}") }
    if (ch.isText) {
        val muted = ch.id in Unread.mutedIds()
        items += MenuItem.Action(if (muted) t("sidebar.serverMenu.unmuteChannel") else t("sidebar.serverMenu.muteChannel"), separatorAfter = true) { Unread.setMuted(ch.id, !muted) }
    }
    if (Nexa.servers.canI(st, P.MANAGE_CHANNELS, ch.id)) {
        items += MenuItem.Action(t("sidebar.serverSidebar.editChannel")) { openChannelSettings(ch.id) }
        items += MenuItem.Action(t("sidebar.serverMenu.deleteChannel"), danger = true) { confirmDeleteChannel(ch) }
    }
    if (Nexa.settings.developerMode) items += MenuItem.Action(t("sidebar.dmMenu.copyChannelId")) { copyText(ch.id) }
    return items
}

// ---------------------------------------------------------------------------
// DM list (DMSidebar.tsx)

@Composable
fun DmSidebar() {
    val c = Nx.colors
    val channels by Nexa.channels.byId.collectAsState()
    val reads by Nexa.readStates.byChannel.collectAsState()
    val rels by Nexa.relationships.byId.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val presences by Nexa.presence.byId.collectAsState()
    @Suppress("UNUSED_VARIABLE") val touch = reads.size + users.size + presences.size
    val route = Nav.route
    val requests = rels.values.count { it.type == "incoming" }
    val convos = channels.values.filter { it.type == "dm" || it.type == "group_dm" }.sortedByDescending { it.lastMessageId ?: it.id }
    Column(Modifier.fillMaxSize()) {
        // search button
        Box(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
            val interaction = remember { MutableInteractionSource() }
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(40.dp)
                    .ring(Radii.Sm, c.borderSubtle).sunken(Radii.Sm, c)
                    .pressable(interaction) { openQuickSwitcher() }
                    .padding(start = 10.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("Search", c.textMuted.copy(alpha = 0.8f), size = 15.dp)
                Txt(t("sidebar.dMSidebar.findOrStartAConversation"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1)
            }
        }
        LazyColumn(Modifier.fillMaxSize().padding(start = 8.dp, end = 8.dp, top = 4.dp)) {
            item("friends") {
                NavRow("Users", t("sidebar.dMSidebar.friends"), route is Route.Friends, requests) { Nav.go(Route.Friends) }
            }
            item("notes") { NavRow("NotebookPen", t("notes.title"), route is Route.Notes, 0) { Nav.go(Route.Notes()) } }
            if (Nexa.users.me.value?.isAdmin == true) item("mod") { NavRow("Shield", t("moderation.navLabel"), route is Route.Admin, 0) { Nav.go(Route.Admin) } }
            item("header") {
                Row(Modifier.fillMaxWidth().height(40.dp).padding(start = 10.dp, end = 8.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt(t("sidebar.dMSidebar.directMessages"), style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, modifier = Modifier.weight(1f))
                    fish.nexa.ui.components.IconButton("Plus", t("sidebar.dMSidebar.createDm"), { openCreateDm() }, tint = c.textMuted, size = 32.dp, iconSize = 16.dp)
                }
            }
            if (convos.isEmpty()) item("empty") {
                Txt(t("sidebar.dMSidebar.noConversationsYetAddAFriend"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 16.dp))
            }
            items(convos, key = { it.id }) { ch -> ConversationRow(ch, (route as? Route.Dm)?.channelId == ch.id) }
            item("end") { Spacer(Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun NavRow(icon: String, label: String, selected: Boolean, badge: Int, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 2.dp)
            .height(42.dp)
            .selectedRow(selected, pressed)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) { Icon(icon, if (selected) c.textBrand else c.textChannel, size = 22.dp) }
        Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = if (selected) c.textStrong else c.textChannel, maxLines = 1, modifier = Modifier.weight(1f))
        CountBadge(badge)
    }
}

@Composable
private fun ConversationRow(ch: Channel, selected: Boolean) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val count = Unread.conversationCount(ch)
    val unread = !selected && Unread.isUnread(Nexa.readStates.get(ch.id), ch.lastMessageId) && !Unread.isMuted(ch.id, null)
    val other = if (ch.type == "dm") Names.otherOf(ch) else null
    val status = other?.let { Nexa.presence.statusOf(it) }
    Box(Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
        if (unread) UnreadEdge(Modifier.align(Alignment.CenterStart))
        Row(
            Modifier
                .fillMaxWidth()
                .height(46.dp)
                .selectedRow(selected, pressed)
                .pressable(interaction, onLongClick = { openMenu(dmMenu(ch), Names.channel(ch)) }) { Nav.go(Route.Dm(ch.id)) }
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ConversationAvatar(ch, 32.dp, status = status)
            Column(Modifier.weight(1f)) {
                Txt(Names.channel(ch), style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550), lineHeight = Nx.type.sp(19.4f)), color = if (selected || unread) c.textStrong else c.textChannel, maxLines = 1)
                val sub = if (ch.type == "group_dm") t("chat.groupMemberList.membersOnly", "count" to ch.recipientIds.size) else other?.let { customStatus(it) }
                if (!sub.isNullOrBlank()) Txt(sub, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
            }
            if (!selected) CountBadge(count)
        }
    }
}

/** A person's custom status as shown (hidden once it expires, and while they are offline or invisible). */
fun customStatus(userId: String): String? {
    val p = Nexa.presence.byId.value[userId]
    if (p == null || p.status == "offline" || p.status == "invisible") return null
    if (p.statusExpiresAt != null && p.statusExpiresAt < System.currentTimeMillis()) return null
    val text = listOf(p.statusEmoji, p.statusText).filter { it.isNotBlank() }.joinToString(" ")
    if (text.isNotBlank()) return text
    return p.activities?.firstOrNull()?.let { a ->
        when (a.type) {
            2 -> t("activity.listeningToName", "name" to a.name)
            3 -> t("activity.watchingName", "name" to a.name)
            5 -> t("activity.competingInName", "name" to a.name)
            1 -> t("activity.streamingName", "name" to a.name)
            else -> t("activity.playingName", "name" to a.name)
        }
    }
}
