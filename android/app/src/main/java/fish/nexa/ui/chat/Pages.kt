package fish.nexa.ui.chat

import fish.nexa.ui.nav.Nav
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.ButtonKind
import fish.nexa.net.wireJson
import fish.nexa.net.Channel
import fish.nexa.net.ApiError
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
    // a link to a message: open there
    LaunchedEffect(route) { if (ch != null && route.jumpTo != null) ChatUi.jumpTo(ch.id, route.jumpTo) }
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

/**
 * DMPage.tsx: a DM, a group or a subchat. One this device has not loaded yet
 * (a link, a notification) is fetched; one that was on screen and then left
 * the list was closed elsewhere, so the page goes back to Friends.
 */
@Composable
fun DmPage(route: Route.Dm) {
    val channels by Nexa.channels.byId.collectAsState()
    val channel = channels[route.channelId]
    var shown by remember { mutableStateOf<String?>(null) }
    var failed by remember(route.channelId) { mutableStateOf(false) }
    var attempt by remember(route.channelId) { mutableIntStateOf(0) }
    LaunchedEffect(channel?.id, route.channelId) {
        if (channel != null) shown = channel.id
        else if (shown == route.channelId) Nav.go(Route.Friends, replace = true)
    }
    LaunchedEffect(route.channelId, channel == null, attempt) {
        if (channel != null || shown == route.channelId) return@LaunchedEffect
        failed = false
        try {
            val ch = wireJson.decodeFromJsonElement(Channel.serializer(), Nexa.api.get("/channels/${route.channelId}"))
            Nexa.channels.upsert(listOf(ch))
        } catch (e: ApiError) {
            if (e.status == 403 || e.status == 404) {
                Nexa.ui.toast(t("dM.thatConversationIsGone"), "error")
                Nav.go(Route.Friends, replace = true)
            } else failed = true
        } catch (_: Exception) {
            failed = true
        }
    }
    LaunchedEffect(route) { route.jumpTo?.let { ChatUi.jumpTo(route.channelId, it) } }
    when {
        channel != null -> ChatView(route.channelId)
        failed -> Column(Modifier.fillMaxSize()) {
            PageHeader("")
            Column(
                Modifier.fillMaxWidth().weight(1f).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Txt(t("dM.thatConversationCouldNotBeOpened"), style = Nx.type.heading, color = Nx.colors.textStrong, align = TextAlign.Center)
                Txt(t("server.theRequestDidNotGetThrough"), style = Nx.type.body, color = Nx.colors.textMuted, align = TextAlign.Center, modifier = Modifier.widthIn(max = 420.dp))
                NxButton(t("chat.messageList.tryAgain"), { attempt += 1 }, kind = ButtonKind.SECONDARY)
            }
        }
        else -> Column(Modifier.fillMaxSize()) {
            PageHeader("")
            Column(
                Modifier.fillMaxWidth().weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spinner(size = 40.dp)
                Txt(t("dM.openingConversation"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = Nx.colors.textMuted)
            }
        }
    }
}
