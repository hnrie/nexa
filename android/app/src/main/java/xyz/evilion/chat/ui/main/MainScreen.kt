package xyz.evilion.chat.ui.main

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.chat.ChatScreen
import xyz.evilion.chat.ui.common.EmptyState
import xyz.evilion.chat.ui.friends.FriendsScreen
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.invite.InviteScreen
import xyz.evilion.chat.ui.server.ServerSettingsScreen
import xyz.evilion.chat.ui.settings.SettingsScreen
import xyz.evilion.chat.ui.sheets.AppLayers
import xyz.evilion.chat.ui.theme.chatColors

/**
 * The shell: servers and channels in a drawer, the open conversation beside
 * it, and whatever sheet is on top of that.
 */
@Composable
fun MainScreen() {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val route by Nav.route.collectAsState()
    val layers by Nav.layers.collectAsState()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val channels by AppState.channels.collectAsState()

    // A conversation that goes away (left the server, closed the DM) sends the
    // reader back to the list rather than to an empty screen.
    LaunchedEffect(route, channels.size) {
        val chat = route as? Route.Chat ?: return@LaunchedEffect
        if (chat.channelId != null && !channels.containsKey(chat.channelId)) {
            Nav.openChannel(chat.serverId, null)
        }
    }

    // anything but a conversation takes the whole screen; the drawer belongs to chat
    LaunchedEffect(route) {
        if (route !is Route.Chat) drawer.close()
    }

    BackHandler(enabled = layers.isNotEmpty() || route !is Route.Chat || drawer.isOpen) {
        when {
            layers.isNotEmpty() -> Nav.pop()
            drawer.isOpen -> scope.launch { drawer.close() }
            route !is Route.Chat -> Nav.go(Route.Chat(null, null))
        }
    }

    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = drawer.isOpen || route is Route.Chat,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = colors.bgRaised,
                drawerShape = androidx.compose.ui.graphics.RectangleShape,
                modifier = Modifier.fillMaxWidth(0.86f),
            ) {
                Sidebar(route) { scope.launch { drawer.close() } }
            }
        },
    ) {
        Box(Modifier.fillMaxSize().background(colors.bgBase)) {
            when (val current = route) {
                is Route.Chat -> {
                    val channelId = current.channelId
                    if (channelId == null) {
                        // Without a bar there is no menu button, and back quits
                        // the app from here: closing the drawer left nothing on
                        // screen that could open it again.
                        Column(Modifier.fillMaxSize()) {
                            Row(
                                Modifier.fillMaxWidth().background(colors.bgRaised).statusBarsPadding()
                                    .height(52.dp).padding(horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                IconButton(onClick = { scope.launch { drawer.open() } }) {
                                    Icon(Lucide.Menu, t("chatScreen.channels"), tint = colors.icon)
                                }
                            }
                            Box(Modifier.weight(1f)) {
                                EmptyState(
                                    Lucide.Hash,
                                    t("main.mainScreen.noConversationOpen"),
                                    t("main.mainScreen.pickOneFromTheListOr"),
                                )
                            }
                        }
                        LaunchedEffect(Unit) { drawer.open() }
                    } else {
                        ChatScreen(current.serverId, channelId) { scope.launch { drawer.open() } }
                    }
                }
                is Route.Friends -> FriendsScreen { scope.launch { drawer.open() } }
                is Route.Settings -> SettingsScreen(current.page)
                is Route.ServerSettings -> ServerSettingsScreen(current.serverId, current.page)
                is Route.Invite -> InviteScreen(current.code, fragment = current.fragment)
                is Route.GuestCall -> InviteScreen(current.code, guest = true)
                is Route.StickerPack -> xyz.evilion.chat.ui.sheets.StickerPackScreen(current.id)
            }
        }
    }

    AppLayers(layers)
}
