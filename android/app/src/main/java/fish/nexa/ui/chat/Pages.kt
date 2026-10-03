package fish.nexa.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.PageHeader
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx

/** ServerPage.tsx: the open channel of a server, or a note that it has none you can read. */
@Composable
fun ServerPage(route: Route.Server) {
    val channels by Nexa.channels.byId.collectAsState()
    val ch = route.channelId?.let { channels[it] }
    when {
        ch == null -> NoChannel(route.serverId)
        ch.type == "voice" -> fish.nexa.ui.voice.VoiceChannelPage(ch)
        else -> ChatView(ch.id)
    }
}

@Composable
private fun NoChannel(serverId: String) {
    val c = Nx.colors
    val name = Nexa.servers.get(serverId)?.server?.name ?: ""
    Column(Modifier.fillMaxSize()) {
        PageHeader(name)
        Column(
            Modifier.fillMaxWidth().weight(1f).padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon("Hash", c.textMuted, size = 48.dp)
            Txt(t("server.noTextChannels"), style = Nx.type.body, color = c.textMuted)
        }
    }
}

/** DMPage.tsx: a DM, a group or a subchat. */
@Composable
fun DmPage(route: Route.Dm) {
    val channels by Nexa.channels.byId.collectAsState()
    if (channels[route.channelId] == null) {
        Box(Modifier.fillMaxSize()) { PageHeader("") }
        return
    }
    ChatView(route.channelId)
}
