package fish.nexa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.ChatMessage
import fish.nexa.data.Forward
import fish.nexa.net.Channel
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken

/** One place a message can go, as the list shows it: its name, and its server's or the person's handle under it. */
private class Place(val ch: Channel, val name: String, val sub: String, val other: String?)

/**
 * Forward Message (the web's ForwardModal): the message as it will go, and
 * the one conversation, group or server channel to send it to, found by its
 * name or its server's. Its files go as they are, without uploading them again.
 */
fun openForward(msg: ChatMessage) {
    val meId = Nexa.users.meId
    val files = msg.payload?.att?.size ?: 0
    val users = Nexa.users.byId.value
    val places = Forward.targets(files > 0).filter { it.id != msg.channelId }.map { ch ->
        val other = if (ch.type == "dm") ch.recipientIds.firstOrNull { it != meId } else null
        val sub = when {
            ch.serverId != null -> Nexa.servers.get(ch.serverId)?.server?.name ?: ""
            other != null -> "@" + (users[other]?.username ?: "")
            else -> t("chat.chatView.membersCount", "count" to ch.recipientIds.size)
        }
        Place(ch, Names.channel(ch), sub, other)
    }
    openSheet("forward", title = t("forward.title")) { close ->
        val c = Nx.colors
        var query by remember { mutableStateOf("") }
        var comment by remember { mutableStateOf("") }
        var picked by remember { mutableStateOf<String?>(null) }
        var busy by remember { mutableStateOf(false) }
        val q = query.trim().lowercase()
        val shown = if (q.isEmpty()) places else places.filter { it.name.lowercase().contains(q) || it.sub.lowercase().contains(q) }

        // the message as it will look, marked forwarded
        Column(
            Modifier.fillMaxWidth().padding(bottom = 14.dp).sunken(Radii.Sm, c).padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon("CornerUpRight", c.textMuted, size = 14.dp)
                Txt(t("forward.forwarded"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12f), fontWeight = FontWeight(600)), color = c.textMuted)
            }
            msg.payload?.t?.takeIf { it.isNotEmpty() }?.let { Txt(fish.nexa.data.Mentions.humanize(it), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.text, maxLines = 3) }
            if (files > 0) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon("Paperclip", c.textSubtle, size = 14.dp)
                    Txt(t("forward.files", "count" to files), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textSubtle)
                }
                Txt(t("forward.noUpload"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12f)), color = c.textMuted)
            }
        }
        fish.nexa.ui.components.NxTextField(comment, { if (it.length <= 4000) comment = it }, label = t("forward.comment"), singleLine = false, minLines = 2, enabled = !busy)
        fish.nexa.ui.server.SearchBox(query, { query = it }, t("forward.search"))
        Txt(t("forward.pickOne"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12f)), color = c.textMuted, modifier = Modifier.padding(top = 10.dp, bottom = 8.dp))
        Column(Modifier.fillMaxWidth().semantics { contentDescription = t("forward.where") }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (shown.isEmpty()) Txt(t("forward.none"), style = Nx.type.bodySmall, color = c.textMuted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
            for (p in shown.take(60)) {
                val on = picked == p.ch.id
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .clip(Radii.Xs)
                        .background(if (on) c.bgSelected else androidx.compose.ui.graphics.Color.Transparent)
                        .pressable(remember { MutableInteractionSource() }) { picked = p.ch.id }
                        .semantics(mergeDescendants = true) { role = Role.RadioButton; selected = on }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    when {
                        p.ch.serverId != null -> Box(Modifier.size(32.dp).background(c.bgActive, CircleShape), contentAlignment = Alignment.Center) { Icon("Hash", c.icon, size = 18.dp) }
                        p.other != null -> Avatar(p.other, p.name, Nexa.users.byId.value[p.other]?.avatarId, 32.dp)
                        else -> Box(Modifier.size(32.dp).background(c.bgActive, CircleShape), contentAlignment = Alignment.Center) { Icon("Users", c.icon, size = 18.dp) }
                    }
                    Column(Modifier.weight(1f)) {
                        fish.nexa.ui.chat.PersonName(p.other, p.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.text, maxLines = 1)
                        if (p.sub.isNotEmpty()) Txt(p.sub, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12f)), color = c.textMuted, maxLines = 1)
                    }
                    // the radio's ring, filled with the accent once picked
                    Box(Modifier.size(20.dp).ring(CircleShape, if (on) c.brand else c.borderStrong, 2.dp), contentAlignment = Alignment.Center) {
                        if (on) Box(Modifier.size(10.dp).background(c.brand, CircleShape))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(t("forward.send"), {
                val to = picked ?: return@NxButton
                busy = true
                Forward.send(msg, to, comment)
                Nexa.ui.toast(t("forward.sent"), "success")
                close()
            }, icon = "CornerUpRight", enabled = picked != null, loading = busy)
        }
    }
}
