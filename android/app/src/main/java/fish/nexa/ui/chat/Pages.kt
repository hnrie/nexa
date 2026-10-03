package fish.nexa.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import fish.nexa.net.Channel
import fish.nexa.ui.components.Txt
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.PageHeader

// TEMPORARY: the chat view, friends page and member lists replace these.
@Composable fun FriendsPage() { Column(Modifier.fillMaxSize()) { PageHeader("Friends") } }
@Composable fun ServerPage(route: Route.Server) { Column(Modifier.fillMaxSize()) { PageHeader(route.channelId ?: "") } }
@Composable fun DmPage(route: Route.Dm) { Column(Modifier.fillMaxSize()) { PageHeader(route.channelId) } }
@Composable fun MemberList(serverId: String, channelId: String?) { Txt("members") }
@Composable fun GroupMemberList(channel: Channel) { Txt("group") }
