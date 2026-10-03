package fish.nexa.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.People
import fish.nexa.net.ApiError
import fish.nexa.net.PublicUser
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.mixOklab

/**
 * Profiles on a phone (ProfilePopoutHost and ProfileModal): the popout a name
 * or a picture opens and the full profile both come up from the bottom as
 * sheets, one at a time, each replacing the other.
 */
object Profiles {
    /** The popout: who they are at a glance, with their roles in [serverId] (the server being looked at, unless given). */
    fun open(userId: String, serverId: String? = null) {
        val sid = serverId ?: (Nav.route as? Route.Server)?.serverId
        lateinit var layer: Layer
        layer = Layer("profile", replaces = "profile") { close -> PopoutSheet(layer, userId, sid, close) }
        Layers.open(layer)
    }

    /** The whole profile, on [tab] when it is opened for one thing (all their widgets, what you have in common). */
    fun openFull(userId: String, tab: ProfileTab? = null) {
        val sid = (Nav.route as? Route.Server)?.serverId
        lateinit var layer: Layer
        layer = Layer("profileFull", replaces = "profile") { close -> FullSheet(layer, userId, tab, sid, close) }
        Layers.open(layer)
    }

    /** A profile link (`/@username`): the person's full profile, or the page's Profile Unavailable. */
    fun openByUsername(username: String) {
        val name = username.trim().removePrefix("@").lowercase()
        val me = Nexa.users.me.value
        if (me != null && me.username.equals(name, ignoreCase = true)) return openFull(me.id)
        lateinit var layer: Layer
        layer = Layer("profileLink", replaces = "profile") { _ -> ProfileLinkSheet(layer, name) }
        Layers.open(layer)
    }
}

@Composable
private fun PopoutSheet(layer: Layer, userId: String, serverId: String?, close: () -> Unit) {
    val user = rememberPerson(userId)
    when {
        user == null -> LoadingProfileSheet(layer, userId)
        AccountFlags.isSystem(user.flags) -> NexaProfileSheet(layer, close)
        else -> {
            val theme = remember(user.accentColor, user.accentColor2) { ProfileTheme.of(user.accentColor, user.accentColor2) }
            Sheet(layer, maxWidth = 480.dp, closeButton = false, bare = true, padding = 0.dp, fill = theme?.bottom) {
                ProfilePopoutCard(user, serverId, close)
            }
        }
    }
}

@Composable
private fun FullSheet(layer: Layer, userId: String, tab: ProfileTab?, serverId: String?, close: () -> Unit) {
    val user = rememberPerson(userId)
    when {
        user == null -> LoadingProfileSheet(layer, userId)
        AccountFlags.isSystem(user.flags) -> NexaProfileSheet(layer, close)
        else -> {
            val theme = remember(user.accentColor, user.accentColor2) { ProfileTheme.of(user.accentColor, user.accentColor2) }
            // a steady height whatever is on it, so changing tabs does not move the sheet
            Sheet(layer, maxWidth = 640.dp, closeButton = false, bare = true, scroll = false, padding = 0.dp, fill = theme?.bottom) {
                Box(Modifier.weight(1f, fill = true)) { FullProfileCard(user, tab, serverId, close) }
            }
        }
    }
}

/** Someone the app does not know yet: asked for, with Retry when that fails (ProfileModal). */
@Composable
private fun LoadingProfileSheet(layer: Layer, userId: String) {
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        failed = false
        try {
            People.profile(userId)
        } catch (_: Exception) {
            failed = true
        }
    }
    val c = Nx.colors
    Sheet(layer, title = t("profile.profile.profile"), maxWidth = 480.dp) {
        if (failed) {
            Txt(t("profile.profile.couldNotLoadThisProfile"), style = Nx.type.bodySmall, color = c.textMuted)
            NxButton(t("chat.messageItem.retry"), { attempt++ }, size = ButtonSize.SM)
        } else Txt(t("chat.pins.loading"), style = Nx.type.bodySmall, color = c.textMuted)
    }
}

/**
 * NexaProfile: the system account is not a person. Nobody can message,
 * befriend or block it, so it shows what it is and the way to what it has sent.
 */
@Composable
private fun NexaProfileSheet(layer: Layer, close: () -> Unit) {
    val c = Nx.colors
    Sheet(layer, maxWidth = 480.dp, closeButton = false, bare = true, padding = 0.dp) {
        Column(Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(110.dp)
                    .background(Brush.linearGradient(listOf(c.brand, mixOklab(c.brand, Color.Black, 0.55f))))
                    .drawBehind {
                        // a soft light from the top-end corner
                        drawCircle(
                            Brush.radialGradient(0f to Color.White.copy(alpha = 0.18f), 0.6f to Color.Transparent, center = Offset(size.width * 0.85f, 0f), radius = size.width * 0.8f),
                            radius = size.width * 0.8f,
                            center = Offset(size.width * 0.85f, 0f),
                        )
                    },
            )
            Box(Modifier.padding(start = 18.dp).offset(y = (-52).dp).background(c.bgFloating, CircleShape).padding(6.dp)) { NexaAvatar(104.dp) }
            Column(
                Modifier.fillMaxWidth().offset(y = (-52).dp).padding(start = 18.dp, end = 18.dp, top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt("Nexa", style = Nx.type.name.copy(fontSize = Nx.type.sp(22f), lineHeight = Nx.type.sp(26f), fontWeight = FontWeight(800)), color = c.textStrong, modifier = Modifier.semantics { heading() })
                    OfficialBadge(compact = false)
                }
                Txt("@nexa", style = Nx.type.bodySmall, color = c.textMuted)
                Txt(t("nexa.profileAbout"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(21.75f)), color = c.text, modifier = Modifier.padding(top = 8.dp))
                Txt(t("nexa.profileNever"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.85f)), color = c.textMuted, modifier = Modifier.padding(bottom = 10.dp))
                NxButton(t("nexa.profileOpen"), {
                    close()
                    Nav.go(Route.NexaConvo)
                }, size = ButtonSize.SM, icon = "MessagesSquare")
            }
        }
    }
}

/** What a profile link leads to: still asking, nobody (or nobody to show), or the server could not be reached. */
private sealed interface LinkState {
    data object Loading : LinkState
    data object Missing : LinkState
    data object Failed : LinkState
}

@Composable
private fun ProfileLinkSheet(layer: Layer, username: String) {
    val c = Nx.colors
    var state by remember { mutableStateOf<LinkState>(LinkState.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        state = LinkState.Loading
        try {
            // what every account sees of them; the full profile then loads the full record itself
            val user = Nexa.api.request("GET", "/profiles/${java.net.URLEncoder.encode(username, "UTF-8")}", PublicUser.serializer())
            Profiles.openFull(user.id)
        } catch (e: ApiError) {
            state = if (e.status == 404) LinkState.Missing else LinkState.Failed
        } catch (_: Exception) {
            state = LinkState.Failed
        }
    }
    Sheet(layer, maxWidth = 480.dp) {
        when (state) {
            LinkState.Loading -> Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Spinner() }
            LinkState.Missing -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(64.dp).background(c.bgActive, RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) { Icon("UserX", c.textMuted, size = 28.dp) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Txt(t("profileLink.missingTitle"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(20f)), color = c.textStrong, modifier = Modifier.semantics { heading() })
                    Txt(t("profileLink.missingBody"), style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(19.6f)), color = c.textMuted)
                }
            }
            LinkState.Failed -> {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Txt(t("profileLink.couldNotLoad"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(20f)), color = c.textStrong, modifier = Modifier.semantics { heading() })
                    Txt(t("invite.checkYourConnection"), style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(19.6f)), color = c.textMuted)
                }
                NxButton(t("invite.tryAgain"), { attempt++ }, block = true, kind = ButtonKind.PRIMARY)
            }
        }
    }
}
