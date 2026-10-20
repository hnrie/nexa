package fish.nexa.ui.apps

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import fish.nexa.Nexa
import fish.nexa.data.P

/**
 * The apps that read every message in a channel (web
 * components/chat/apps/readingApps.ts): bots whose app has the Message
 * Content intent and that can see it. The server opens messages for them, so
 * here messages are not end-to-end encrypted from those apps; the start of
 * the channel names them.
 */
@Composable
fun readingApps(serverId: String?, channelId: String): List<String> {
    val users by Nexa.users.byId.collectAsState()
    val servers by Nexa.servers.byId.collectAsState()
    val channels by Nexa.channels.byId.collectAsState()
    val st = serverId?.let { servers[it] } ?: return emptyList()
    return remember(users, st, channels[channelId]) {
        st.members.keys.filter { id -> users[id]?.readsAll == true && P.has(Nexa.servers.channelPerms(st, channelId, id), P.VIEW_CHANNEL) }.sorted()
    }
}
