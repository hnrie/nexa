package fish.nexa.ui.server

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.media.Media
import fish.nexa.net.Server
import fish.nexa.ui.components.AvatarColor
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.shell.ChannelTree
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * ServerOverviewPage: the icon and banner (they go up at once, cropped
 * first), the name, description, system channel and default notifications
 * (drafts, saved with the save bar). Needs Manage Server.
 */
@Composable
fun OverviewPage(serverId: String) {
    val c = Nx.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val channels by Nexa.channels.byId.collectAsState()
    val server = servers[serverId]?.server ?: return
    var name by remember { mutableStateOf(server.name) }
    var description by remember { mutableStateOf(server.description) }
    var system by remember { mutableStateOf(server.systemChannelId ?: "") }
    var notif by remember { mutableIntStateOf(server.defaultNotifications) }
    var nsfw by remember { mutableStateOf(server.nsfw) }
    var busy by remember { mutableStateOf(false) }
    val texts = remember(channels) {
        val tree = ChannelTree.of(serverId, channels.values)
        (tree.loose + tree.categories.flatMap { it.children }).filter { it.isText }
    }
    val dirty = nsfw != server.nsfw || name != server.name || description != server.description || system != (server.systemChannelId ?: "") || notif != server.defaultNotifications

    fun reset() {
        nsfw = server.nsfw
        name = server.name
        description = server.description
        system = server.systemChannelId ?: ""
        notif = server.defaultNotifications
    }

    fun save() {
        busy = true
        scope.launch {
            try {
                val body = buildJsonObject {
                    if (nsfw != server.nsfw) put("nsfw", nsfw)
                    if (name != server.name) put("name", name)
                    if (description != server.description) put("description", description)
                    if (system != (server.systemChannelId ?: "")) if (system.isEmpty()) put("system_channel_id", JsonNull) else put("system_channel_id", system)
                    if (notif != server.defaultNotifications) put("default_notifications", notif)
                }
                val srv = Nexa.api.request("PATCH", "/servers/$serverId", Server.serializer(), body)
                Nexa.servers.setServer(srv)
                // the server tidies whitespace: show what it kept, or the save bar never goes away
                nsfw = srv.nsfw
                name = srv.name
                description = srv.description
                system = srv.systemChannelId ?: ""
                notif = srv.defaultNotifications
                Nexa.ui.toast(t("server.serverOverview.serverSaved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.serverOverview.couldNotSaveTheServer")), "error")
            } finally {
                busy = false
            }
        }
    }

    fun upload(kind: String, r: CropResult) {
        busy = true
        scope.launch {
            try {
                val area = r.crop?.let { "?x=${it.x}&y=${it.y}&w=${it.w}&h=${it.h}" } ?: ""
                val el = ServerApi.upload("PUT", "/servers/$serverId/$kind$area", r.bytes, r.type)
                Nexa.servers.setServer(fish.nexa.net.wireJson.decodeFromJsonElement(Server.serializer(), el))
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, if (kind == "icon") t("server.serverOverview.couldNotUploadTheIcon") else t("server.serverOverview.couldNotUploadTheBanner")), "error")
            } finally {
                busy = false
            }
        }
    }

    fun remove(kind: String) {
        busy = true
        scope.launch {
            try {
                Nexa.api.request("DELETE", "/servers/$serverId/$kind")
                val cur = Nexa.servers.get(serverId)?.server
                if (cur != null) Nexa.servers.setServer(if (kind == "icon") cur.copy(iconId = null) else cur.copy(bannerId = null))
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, if (kind == "icon") t("server.serverOverview.couldNotRemoveTheIcon") else t("server.serverOverview.couldNotRemoveTheBanner")), "error")
            } finally {
                busy = false
            }
        }
    }

    var picking by remember { mutableStateOf("icon") }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val kind = picking
        scope.launch {
            val f = runCatching { ServerApi.read(context, uri) }.getOrNull() ?: return@launch
            if (kind == "icon") openImageCrop(f, 1f, round = true, title = t("server.serverOverview.cropTheServerIcon"), maxSize = 1024, serverCrop = true) { upload("icon", it) }
            else openImageCrop(f, 16f / 9f, round = false, title = t("server.serverOverview.cropTheServerBanner"), maxSize = 1280, serverCrop = true) { upload("banner", it) }
        }
    }
    fun choose(kind: String) {
        picking = kind
        pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }

    SettingsPage(SaveState(dirty, busy, ::reset, ::save)) {
        PageTitle(t("server.serverOverview.serverOverview"))
        Form {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                BigServerIcon(server)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Hint(t("server.serverOverview.weRecommendAnImageOfAt"), top = 0.dp)
                    Wrap {
                        NxButton(t("server.serverOverview.uploadImage"), { choose("icon") }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, enabled = !busy)
                        if (server.iconId != null) NxButton(t("composer.composer.remove"), { remove("icon") }, kind = ButtonKind.GHOST, size = ButtonSize.SM, enabled = !busy)
                    }
                }
            }
            Field(t("server.serverOverview.serverBanner"), hint = t("server.serverOverview.serverBannerHint")) {
                BannerBox(server) {
                    NxButton(if (server.bannerId != null) t("settings.profile.changeBanner") else t("server.serverOverview.uploadImage"), { choose("banner") }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, enabled = !busy)
                    if (server.bannerId != null) NxButton(t("composer.composer.remove"), { remove("banner") }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, enabled = !busy)
                }
            }
            NxTextField(name, { name = it.take(100) }, label = t("modals.createServer.serverName"), required = true, capitalize = true)
            Field(t("server.serverOverview.serverDescription"), hint = t("server.serverOverview.shownOnInvitePagesSoPeople")) {
                fish.nexa.ui.format.FormattedTextField(
                    description, { description = it }, 1000,
                    placeholder = t("server.serverOverview.whatIsThisServerAbout"),
                    title = t("server.serverOverview.serverDescription"),
                    serverId = serverId,
                )
            }
            Field(t("server.serverOverview.systemMessagesChannel"), hint = t("server.serverOverview.joinMessagesArePostedHere")) {
                SelectField(
                    listOf("" to t("server.serverOverview.noSystemMessages")) + texts.map { it.id to "#${it.name}" },
                    system, { system = it },
                    title = t("server.serverOverview.systemMessagesChannel"),
                )
            }
            Field(t("server.serverOverview.defaultNotificationSettings"), hint = t("server.serverOverview.whatNewMembersGetUntilThey")) {
                Column {
                    RadioCard(t("server.serverOverview.allMessages"), notif == 0, { notif = 0 })
                    RadioCard(t("server.serverOverview.onlyMentions"), notif == 1, { notif = 1 })
                }
            }
            fish.nexa.ui.components.ToggleLine(t("nsfw.label"), nsfw, { nsfw = it }, description = t("nsfw.serverHint"), enabled = !busy, descriptionBelow = true)
        }
    }
}

/** `.serverIcon`: 100 dp, rounded 30, the picture or the initials on the raised surface. */
@Composable
private fun BigServerIcon(server: Server) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val c = Nx.colors
    val shape = RoundedCornerShape(30.dp)
    val density = LocalDensity.current.density
    Box(
        Modifier
            .size(100.dp)
            .shadowMedium(shape, c)
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape),
        contentAlignment = Alignment.Center,
    ) {
        val url = Media.iconUrl(server.iconId, 128, density)
        if (url != null) AsyncImage(url, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Txt(AvatarColor.initials(server.name), style = Nx.type.title.copy(fontSize = Nx.type.sp(30f), fontWeight = FontWeight(690)), color = c.textStrong)
    }
}

/** `.serverBanner`: 16:9, at most 360 dp wide, the picture as cover, its buttons on it. */
@Composable
private fun BannerBox(server: Server, buttons: @Composable () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val c = Nx.colors
    val shape = fish.nexa.ui.theme.Radii.Md
    val density = LocalDensity.current.density
    Box(
        Modifier
            .widthIn(max = 360.dp)
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .shadowMedium(shape, c)
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .clip(shape),
    ) {
        Media.bannerUrl(server.bannerId, 600, density)?.let { AsyncImage(it, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        Row(Modifier.align(Alignment.BottomEnd).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { buttons() }
    }
}
