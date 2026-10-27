package fish.nexa.ui.share

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Ids
import fish.nexa.data.P
import fish.nexa.net.Channel
import fish.nexa.ui.chat.ChatUi
import fish.nexa.ui.chat.Staging
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ServerIcon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.ChannelGlyph
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.launch

/**
 * Sharing into Nexa from another app (a phone's addition): words and files
 * handed over by the system's share sheet wait here until a conversation is
 * picked, then go into that conversation's message box and file tray, ready
 * to send as they are or with a few words added.
 */
object Share {
    data class Incoming(val text: String?, val uris: List<Uri>)

    /** An exported share target must not open its own private files for a caller. */
    internal fun acceptsUri(scheme: String?, authority: String?, packageName: String): Boolean {
        // Android strips a user-id prefix before looking up the provider.
        val provider = authority?.substringAfterLast('@')
        return scheme == "content" && !provider.isNullOrEmpty() && provider != "$packageName.files"
    }

    /** Reads a share intent; null when it is not one. */
    fun from(intent: Intent?): Incoming? {
        intent ?: return null
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return null
        val text = listOfNotNull(intent.getStringExtra(Intent.EXTRA_SUBJECT), intent.getStringExtra(Intent.EXTRA_TEXT))
            .filter { it.isNotBlank() }.distinct().joinToString("\n").ifBlank { null }
        val uris = ArrayList<Uri>()
        @Suppress("DEPRECATION")
        if (intent.action == Intent.ACTION_SEND) {
            val u = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
            if (u != null) uris += u
        } else {
            val list = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
            if (list != null) uris += list
        }
        val safeUris = uris.filter { acceptsUri(it.scheme, it.authority, Nexa.app.packageName) }.take(Staging.MAX_FILES)
        if (text == null && safeUris.isEmpty()) return null
        return Incoming(text, safeUris)
    }

    /** A direct share target (a conversation shortcut in the system's share sheet) names its channel. */
    fun channelOf(intent: Intent?): String? = intent?.getStringExtra("android.intent.extra.shortcut.ID")?.removePrefix("conv-")?.takeIf { Regex("^\\d{1,20}$").matches(it) }

    /** Puts the shared things into a conversation: the files are copied in now, while the app may still read them. */
    fun deliver(incoming: Incoming, channelId: String) {
        val ch = Nexa.channels.get(channelId) ?: return
        Nav.go(if (ch.serverId != null) Route.Server(ch.serverId, channelId) else Route.Dm(channelId))
        incoming.text?.let { ChatUi.inject[channelId] = it }
        if (incoming.uris.isNotEmpty()) Nexa.scope.launch {
            val staged = incoming.uris.mapNotNull { Staging.stage(it) }
            val cur = ChatUi.trays[channelId] ?: emptyList()
            ChatUi.trays[channelId] = (cur + staged).take(Staging.MAX_FILES)
            staged.drop(maxOf(0, Staging.MAX_FILES - cur.size)).forEach { it.file.delete() }
        }
    }

    /** Where it can go: conversations and channels you may write in, the most recently active first. */
    fun targets(): List<Channel> {
        val all = Nexa.channels.byId.value.values
        return all.filter { ch ->
            when (ch.type) {
                "dm", "group_dm" -> true
                "text" -> {
                    val st = ch.serverId?.let { Nexa.servers.get(it) } ?: return@filter false
                    Nexa.servers.canI(st, P.VIEW_CHANNEL, ch.id) && Nexa.servers.canI(st, P.SEND_MESSAGES, ch.id)
                }
                else -> false
            }
        }.sortedWith { a, b -> Ids.compare(b.lastMessageId ?: b.id, a.lastMessageId ?: a.id) }
    }

    const val SHARE_CATEGORY = "fish.nexa.category.SHARE_TARGET"

    /**
     * The few conversations most recently active, as conversation shortcuts:
     * they appear in the system's share sheet (send straight there) and tie
     * each conversation's notification to its person or group.
     */
    fun publishShortcuts() {
        val ctx = Nexa.app
        val list = targets().filter { it.type == "dm" || it.type == "group_dm" }.take(4)
        val shortcuts = list.map { ch ->
            val name = label(ch).ifBlank { "Nexa" }
            val intent = Intent(ctx, fish.nexa.MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                putExtra(fish.nexa.notify.Notifier.EXTRA_PATH, "/channels/@me/${ch.id}")
            }
            androidx.core.content.pm.ShortcutInfoCompat.Builder(ctx, "conv-${ch.id}")
                .setShortLabel(name)
                .setLongLived(true)
                .setIntent(intent)
                .setCategories(setOf(SHARE_CATEGORY))
                .setIcon(androidx.core.graphics.drawable.IconCompat.createWithResource(ctx, fish.nexa.R.mipmap.ic_launcher))
                .apply { if (ch.type == "dm") Names.otherOf(ch)?.let { setPerson(androidx.core.app.Person.Builder().setName(name).setKey(it).build()) } }
                .build()
        }
        runCatching {
            androidx.core.content.pm.ShortcutManagerCompat.setDynamicShortcuts(ctx, shortcuts)
        }
    }

    /** The picker: a sheet of conversations to send it to, with a search. */
    fun openPicker(incoming: Incoming) {
        lateinit var layer: Layer
        layer = Layer("share") { close ->
            Sheet(layer, title = t("android.share.title")) {
                var query by remember { mutableStateOf("") }
                NxTextField(query, { query = it }, placeholder = t("sidebar.dMSidebar.findAConversation"), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
                val q = query.trim().lowercase()
                val list = remember(q) {
                    targets().filter { ch -> q.isEmpty() || label(ch).lowercase().contains(q) || (ch.serverId?.let { Nexa.servers.get(it)?.server?.name?.lowercase()?.contains(q) } == true) }.take(60)
                }
                if (list.isEmpty()) Txt(t("android.share.nothing"), style = Nx.type.body, color = Nx.colors.textMuted, modifier = Modifier.padding(vertical = 16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (ch in list) TargetRow(ch) {
                        close()
                        deliver(incoming, ch.id)
                    }
                }
            }
        }
        Layers.open(layer)
    }

    private fun label(ch: Channel): String = when (ch.type) {
        "dm" -> Names.otherOf(ch)?.let { Names.shown(it) } ?: ""
        "group_dm" -> Names.channel(ch)
        else -> ch.name
    }

    @Composable
    private fun TargetRow(ch: Channel, onClick: () -> Unit) {
        val c = Nx.colors
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .background(if (pressed) c.bgHover else Color.Transparent, Radii.Sm)
                .pressable(interaction, onClick = onClick)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (ch.type) {
                "dm" -> Names.otherOf(ch)?.let { Avatar(it, Names.shown(it), Nexa.users.get(it)?.avatarId, 32.dp) }
                "group_dm" -> Avatar(ch.id, Names.channel(ch), ch.iconId, 32.dp, icon = true)
                else -> ch.serverId?.let { sid -> Nexa.servers.get(sid)?.server?.let { s -> ServerIcon(s.id, s.name, s.iconId, 32.dp, radius = 10.dp) } }
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (ch.type == "text") ChannelGlyph(ch, 16.dp, c.textMuted)
                    Txt(label(ch), style = Nx.type.body.copy(fontWeight = FontWeight(550)), color = c.textStrong, maxLines = 1)
                }
                ch.serverId?.let { Nexa.servers.get(it)?.server?.name }?.let { Txt(it, style = Nx.type.hint, color = c.textMuted, maxLines = 1) }
            }
        }
    }
}
