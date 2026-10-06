package fish.nexa.ui.follows

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Follows
import fish.nexa.data.P
import fish.nexa.net.Channel
import fish.nexa.ui.Icon
import fish.nexa.ui.components.SelectField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.dialogs.DialogHint
import fish.nexa.ui.dialogs.FooterButtons
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.launch

/**
 * FollowDialog.tsx: an announcement channel followed into a channel of a
 * server this account runs, where its published posts then show up, still
 * end-to-end encrypted.
 */
fun openFollow(channelId: String) = fish.nexa.ui.dialogs.open("follow") { layer, close -> FollowSheet(layer, channelId, close) }

@Composable
private fun FollowSheet(layer: Layer, channelId: String, close: () -> Unit) {
    val source = Nexa.channels.get(channelId) ?: return
    // where posts can go: text channels this account may manage webhooks in
    val targets = remember {
        val byId = Nexa.servers.byId.value
        Nexa.servers.order.value.mapNotNull { sid ->
            val st = byId[sid] ?: return@mapNotNull null
            val list = Nexa.channels.byId.value.values
                .filter { it.serverId == sid && it.isText && it.id != channelId && Nexa.servers.canI(st, P.MANAGE_WEBHOOKS, it.id) }
                .sortedWith(compareBy<Channel>({ it.position }, { it.id.length }, { it.id }))
            if (list.isEmpty()) null else Triple(sid, st.server.name, list)
        }
    }
    var serverId by remember { mutableStateOf(targets.firstOrNull()?.first ?: "") }
    var targetId by remember { mutableStateOf(targets.firstOrNull()?.third?.firstOrNull()?.id ?: "") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val choices = targets.firstOrNull { it.first == serverId }?.third ?: emptyList()
    fun follow() {
        val target = Nexa.channels.get(targetId) ?: return
        if (busy) return
        busy = true
        scope.launch {
            try {
                Follows.followInto(source, target)
                Nexa.ui.toast(t("follows.dialog.done", "source" to source.name, "target" to target.name), "success")
                close()
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("follows.dialog.failed")), "error")
            } finally {
                busy = false
            }
        }
    }
    Sheet(layer, title = t("follows.dialog.title", "name" to source.name), maxWidth = 460.dp, footer = {
        FooterButtons(t("follows.dialog.follow"), ::follow, close, enabled = targetId.isNotEmpty(), busy = busy)
    }) {
        // `.keyNote`: set into the sheet, in small muted words
        Row(
            Modifier
                .fillMaxWidth()
                .ring(Radii.Sm, Nx.colors.borderSubtle)
                .background(androidx.compose.ui.graphics.lerp(Nx.colors.bgFloating, Nx.colors.bgBase, 0.6f), Radii.Sm)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon("Megaphone", Nx.colors.positive, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
            Txt(t("follows.dialog.what"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = Nx.colors.textMuted)
        }
        if (targets.isEmpty()) DialogHint(t("follows.dialog.nowhere"))
        else {
            SelectField(t("follows.dialog.server"), targets.map { it.first to it.second }, serverId) { sid ->
                serverId = sid
                targetId = targets.firstOrNull { it.first == sid }?.third?.firstOrNull()?.id ?: ""
            }
            SelectField(t("follows.dialog.channel"), choices.map { it.id to "#${it.name}" }, targetId) { targetId = it }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon("Info", Nx.colors.textMuted, size = 13.dp)
                Txt(t("follows.dialog.listedHint"), style = Nx.type.hint, color = Nx.colors.textMuted)
            }
        }
    }
}
