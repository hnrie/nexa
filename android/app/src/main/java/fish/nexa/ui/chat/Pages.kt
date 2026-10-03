package fish.nexa.ui.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import fish.nexa.Nexa
import fish.nexa.net.Channel
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.PageHeader
import fish.nexa.ui.t
import fish.nexa.ui.voice.CallArea
import fish.nexa.ui.voice.VoiceChannelPage
import fish.nexa.voice.Calls

// TEMPORARY: the chat view, friends page and member lists replace these. The calls
// wiring here (CallArea in a conversation, VoiceView on a voice channel's page,
// the header's call buttons) is what those pages call.
@Composable fun FriendsPage() { Column(Modifier.fillMaxSize()) { PageHeader("Friends") } }

@Composable fun ServerPage(route: Route.Server) {
    val ch = route.channelId?.let { Nexa.channels.get(it) }
    if (ch?.type == "voice") VoiceChannelPage(ch) else Column(Modifier.fillMaxSize()) { PageHeader(ch?.name ?: "") }
}

@Composable fun DmPage(route: Route.Dm) {
    val ch = Nexa.channels.get(route.channelId)
    Column(Modifier.fillMaxSize()) {
        PageHeader(ch?.let { Names.channel(it) } ?: "", actions = {
            IconButton("Phone", t("chat.chat.startVoiceCall"), { Calls.join(route.channelId) })
            IconButton("Video", t("chat.chat.startVideoCall"), { Calls.join(route.channelId, video = true) })
        })
        CallArea(route.channelId, Modifier.weight(1f)) { Box(Modifier.fillMaxSize()) }
    }
}

@Composable fun MemberList(serverId: String, channelId: String?) { Txt("members") }
@Composable fun GroupMemberList(channel: Channel) { Txt("group") }
