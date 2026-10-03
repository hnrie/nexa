package fish.nexa.ui.voice

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Conv
import fish.nexa.data.P
import fish.nexa.net.ApiError
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.NxToggle
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.shell.openSettings
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import fish.nexa.voice.AudioRoute
import fish.nexa.voice.CallState
import fish.nexa.voice.Calls
import fish.nexa.voice.GuestLink
import fish.nexa.voice.ScreenConsent
import fish.nexa.voice.VideoCap
import fish.nexa.voice.Voice
import fish.nexa.voice.VoiceApi
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// --- noise suppression (noiseMode.ts) --------------------------------------------

/** "Enhanced (RNNoise)", "Standard", "Off". */
fun noiseLabel(mode: String): String = when (mode) {
    "enhanced" -> t("voice.noise.enhanced")
    "standard" -> t("voice.noise.standard")
    else -> t("voice.noise.off")
}

/** Picks a noise mode, keeping the switch older copies of the app read in step with it. */
fun setNoiseMode(mode: String) {
    if (Voice.setting("noiseMode") == mode) return
    Nexa.settings.patch(buildJsonObject {
        put("voice", buildJsonObject {
            put("noiseMode", mode)
            put("noiseSuppression", mode != "off")
        })
    })
}

private fun noiseItems(): List<MenuItem> {
    val mode = Voice.setting("noiseMode") ?: "enhanced"
    return listOf(MenuItem.Heading(t("voice.noise.title"))) + listOf("enhanced", "standard", "off").map { m ->
        MenuItem.Action(noiseLabel(m), checked = mode == m) { setNoiseMode(m) }
    }
}

fun openNoiseMenu() = openMenu(noiseItems().drop(1), title = t("voice.noise.title"))

// --- where the sound plays ----------------------------------------------------------------

private fun routeLabel(d: AudioRoute.Device): String = when (d.kind) {
    AudioRoute.Kind.SPEAKER -> t("android.call.speaker")
    AudioRoute.Kind.EARPIECE -> t("android.call.earpiece")
    AudioRoute.Kind.WIRED -> d.name.ifBlank { t("android.call.headphones") }
    AudioRoute.Kind.USB -> d.name.ifBlank { t("android.call.usbHeadset") }
    AudioRoute.Kind.BLUETOOTH -> d.name.ifBlank { t("android.call.bluetooth") }
    AudioRoute.Kind.OTHER -> d.name
}

private fun routeItems(): List<MenuItem> {
    val current = AudioRoute.current.value
    return AudioRoute.devices.value.map { d ->
        MenuItem.Action(routeLabel(d), checked = current?.id == d.id && current.kind == d.kind) { AudioRoute.choose(d) }
    }
}

/** The output button's menu: the speaker, the earpiece, a headset. */
fun openOutputMenu() = openMenu(routeItems(), title = t("voice.deviceMenus.outputDevice"))

/** The microphone's menu (deviceMenus.ts micMenuItems): where the call plays, noise suppression, the voice settings. */
fun openMicMenu() {
    val items = ArrayList<MenuItem>()
    val routes = routeItems()
    if (routes.isNotEmpty()) {
        items += MenuItem.Heading(t("voice.deviceMenus.outputDevice"))
        items += routes.dropLast(1)
        items += (routes.last() as MenuItem.Action).copy(separatorAfter = true)
    }
    val noise = noiseItems()
    items += noise.dropLast(1)
    items += (noise.last() as MenuItem.Action).copy(separatorAfter = true)
    items += MenuItem.Action(t("voice.deviceMenus.voiceSettings")) { openSettings() }
    openMenu(items, title = t("voice.voice.microphoneOptions"))
}

/** The camera's menu: which way it faces, and the video settings. */
fun openCameraMenu() {
    val count = fish.nexa.voice.Engine.cameraCount()
    val items = ArrayList<MenuItem>()
    items += MenuItem.Heading(t("settings.voice.camera"))
    if (count == 0) items += MenuItem.Action(t("voice.deviceMenus.noCameraFound"), disabled = true) {}
    else {
        val front = Voice.state.value.localFront
        items += MenuItem.Action(t("android.call.frontCamera"), checked = front) { if (!front) Calls.flipCamera() }
        items += MenuItem.Action(t("android.call.backCamera"), checked = !front, separatorAfter = true) { if (front) Calls.flipCamera() }
    }
    items += MenuItem.Action(t("voice.deviceMenus.videoSettings")) { openSettings() }
    openMenu(items, title = t("voice.voice.cameraOptions"))
}

// --- a person in the call ---------------------------------------------------------------

private fun copy(text: String) {
    val cm = Nexa.app.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("", text))
}

/** Whether this device may put guests out of a call: anyone in a DM or group, and a voice channel's movers. */
private fun canRemoveGuests(channelId: String): Boolean {
    val ch = Nexa.channels.get(channelId) ?: return false
    if (ch.type == "dm" || ch.type == "group_dm") return true
    val sid = ch.serverId ?: return false
    return Nexa.servers.canI(Nexa.servers.get(sid), P.MOVE_MEMBERS, channelId)
}

private fun removeGuest(channelId: String, userId: String) {
    Nexa.scope.launch {
        try {
            VoiceApi.removeGuest(channelId, userId)
        } catch (e: ApiError) {
            Nexa.ui.toast(e.message ?: t("voice.voiceParticipants.couldNotRemoveTheGuest"), "error")
        } catch (e: Exception) {
            Nexa.ui.toast(t("voice.voiceParticipants.couldNotRemoveTheGuest"), "error")
        }
    }
}

/** Someone's volume and local mute (the same menu under a voice channel and on their tile). */
private fun volumeItems(userId: String): List<MenuItem> {
    val mix = Voice.mix.value
    val vol = mix.volumes[userId] ?: 100
    val muted = userId in mix.localMutes
    return listOf(
        MenuItem.Slider(t("voice.voiceParticipants.userVolume"), vol.toFloat(), 0f..200f, "%") { Calls.setUserVolume(userId, it.toInt()) },
        MenuItem.Action(if (muted) t("voice.voice.unmute") else t("voice.voice.mute")) { Calls.setUserLocalMute(userId, !muted) },
        MenuItem.Action(t("voice.voiceParticipants.resetVolume"), disabled = vol == 100) { Calls.setUserVolume(userId, 100) },
    )
}

/** The long-press menu of someone listed under a voice channel (VoiceParticipants.tsx). */
fun voicePersonMenu(userId: String, channelId: String): List<MenuItem> {
    val guest = isGuestUser(userId)
    val items = ArrayList<MenuItem>()
    val profile = MenuItem.Action(t("profile.profile.profile")) { openProfile(userId) }
    if (userId == Nexa.users.meId) return listOf(profile)
    if (!guest) items += profile.copy(separatorAfter = true)
    val vol = volumeItems(userId)
    items += vol.dropLast(1)
    val canRemove = guest && canRemoveGuests(channelId)
    items += (vol.last() as MenuItem.Action).copy(separatorAfter = canRemove)
    if (canRemove) items += MenuItem.Action(t("voice.voiceParticipants.removeFromCall"), danger = true) { removeGuest(channelId, userId) }
    if (!guest && Nexa.settings.developerMode) items += MenuItem.Action(t("chat.groupMemberMenu.copyUserId")) { copy(userId) }
    return items
}

/** A tile's long-press menu (VoiceView tileMenu). */
internal fun tileMenu(t: Tile, channelId: String, state: CallState) {
    val guestTile = isGuestUser(t.userId)
    val items = ArrayList<MenuItem>()
    // a guest has no profile
    if (!guestTile) items += MenuItem.Action(fish.nexa.ui.t("profile.profile.profile")) { openProfile(t.userId) }
    if (t.kind == Tile.Kind.RINGING) {
        if (items.isNotEmpty()) openMenu(items, title = callName(t.userId, channelId))
        return
    }
    fun sep() {
        val last = items.lastOrNull() as? MenuItem.Action ?: return
        items[items.size - 1] = last.copy(separatorAfter = true)
    }
    if (t.kind == Tile.Kind.SCREEN && t.me) items += MenuItem.Action(fish.nexa.ui.t("voice.voice.stopSharing")) { Calls.stopScreenShare() }
    if (t.kind == Tile.Kind.SCREEN && !t.me) {
        val watching = t.userId in state.watching
        items += MenuItem.Action(if (watching) fish.nexa.ui.t("voice.voice.stopWatching") else fish.nexa.ui.t("voice.voice.watchStream")) { Calls.setWatching(t.userId, !watching) }
    }
    if (showsStream(t, state)) {
        val focused = state.focused == t.key
        items += MenuItem.Action(if (focused) fish.nexa.ui.t("voice.voice.unfocus") else fish.nexa.ui.t("voice.voice.focus")) { Voice.update { it.copy(focused = if (focused) null else t.key) } }
    }
    if (!t.me && t.kind == Tile.Kind.SCREEN) {
        // a stream's sound has its own level: turning a loud game down leaves the person's voice alone
        val mix = Voice.mix.value
        val vol = mix.streamVolumes[t.userId] ?: 100
        val muted = t.userId in mix.streamMutes
        sep()
        items += MenuItem.Slider(fish.nexa.ui.t("voice.voice.streamVolume"), vol.toFloat(), 0f..200f, "%") { Calls.setStreamVolume(t.userId, it.toInt()) }
        items += MenuItem.Action(if (muted) fish.nexa.ui.t("voice.voice.unmuteStream") else fish.nexa.ui.t("voice.voice.muteStream")) { Calls.setStreamLocalMute(t.userId, !muted) }
        items += MenuItem.Action(fish.nexa.ui.t("voice.voice.resetStreamVolume"), disabled = vol == 100) { Calls.setStreamVolume(t.userId, 100) }
    } else if (!t.me) {
        sep()
        items += volumeItems(t.userId)
    }
    if (guestTile && t.kind != Tile.Kind.SCREEN && canRemoveGuests(channelId)) {
        sep()
        items += MenuItem.Action(fish.nexa.ui.t("voice.voiceParticipants.removeFromCall"), danger = true) { removeGuest(channelId, t.userId) }
    }
    if (!guestTile && Nexa.settings.developerMode) {
        sep()
        items += MenuItem.Action(fish.nexa.ui.t("chat.groupMemberMenu.copyUserId")) { copy(t.userId) }
    }
    if (items.isNotEmpty()) openMenu(items, title = callName(t.userId, channelId))
}

// --- sharing the screen (ShareScreenModal.tsx) -----------------------------------------------

/** A row of choices that behaves as a radio group. */
@Composable
private fun <T> Choices(label: String, options: List<Triple<T, String, String>>, value: T, onChange: (T) -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt(label, style = Nx.type.label, color = c.textSubtle)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((v, title, note) in options) {
                val on = v == value
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                val shape = Radii.Md
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 58.dp)
                        .ring(shape, if (on) c.brand.copy(alpha = 0.85f) else if (pressed) c.borderStrong else c.borderSubtle, if (on) 2.dp else 1.dp)
                        .background(if (on) mixOklab(c.bgSurface, c.brand, 0.14f) else c.bgSurface, shape)
                        .background(sheen(c), shape)
                        .topEdge(shape, c.edgeLight)
                        .clip(shape)
                        .pressable(interaction, role = Role.RadioButton) { onChange(v) }
                        .semantics { selected = on; contentDescription = "$title, $note" }
                        .padding(horizontal = 4.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
                ) {
                    Txt(title, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                    Txt(note, style = Nx.type.hint, color = c.textMuted, maxLines = 1)
                }
            }
        }
    }
}

/** Asks for a share's resolution and frame rate, then the phone asks what to share. */
fun openShareScreen() {
    openSheet("share-screen", title = t("voice.shareScreen.shareYourScreen"), footer = { close ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(t("voice.shareScreen.goLive"), {
                close()
                ShareChoice.goLive()
            }, icon = "MonitorUp")
        }
    }) {
        val c = Nx.colors
        var res by remember { mutableStateOf(Voice.setting("shareResolution")?.takeIf { it in VideoCap.RESOLUTIONS } ?: "1080p") }
        var fps by remember { mutableIntStateOf(Voice.settingInt("shareFps", 30).takeIf { it in VideoCap.FRAME_RATES } ?: 30) }
        LaunchedEffect(res, fps) {
            ShareChoice.res = res
            ShareChoice.fps = fps
        }
        val resNotes = mapOf("720p" to "HD", "1080p" to t("voice.shareScreen.fullHd"), "1440p" to "QHD", "source" to t("voice.shareScreen.native"))
        Choices(t("voice.shareScreen.resolution"), VideoCap.RESOLUTIONS.map { Triple(it, if (it == "source") t("shareQuality.source") else it, resNotes.getValue(it)) }, res) { res = it }
        val fpsNotes = mapOf(15 to t("voice.shareScreen.textSlides"), 30 to t("voice.shareScreen.smooth"), 60 to t("voice.shareScreen.gamesVideo"))
        Choices(t("voice.shareScreen.frameRate"), VideoCap.FRAME_RATES.map { Triple(it, "$it fps", fpsNotes.getValue(it)) }, fps) { fps = it }
        // a phone shares the picture; its sound cannot go into the call as a share's own
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Txt(t("voice.shareScreen.shareAudio"), style = Nx.type.body.copy(fontWeight = FontWeight(550)), color = c.text)
                Txt(t("android.call.shareNoSound"), style = Nx.type.hint, color = c.textMuted)
            }
            NxToggle(false, {}, enabled = false, label = t("voice.shareScreen.shareAudio"))
        }
        val mbps = VideoCap.shareBitrate(res, fps) / 1_000_000.0
        val shown = if (mbps == Math.floor(mbps)) mbps.toInt().toString() else String.format(fish.nexa.ui.I18n.locale, "%.1f", mbps)
        Txt(
            (if (res == "source") t("voice.shareScreen.sharesAtYourScreenSOwn") else "") + t("android.call.shareUpload", "mbps" to shown),
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)),
            color = c.textMuted,
        )
    }
}

/** What the share sheet chose, kept for its Go Live. */
private object ShareChoice {
    var res = "1080p"
    var fps = 30

    fun goLive() {
        val r = res
        val f = fps
        if (Voice.setting("shareResolution") != r || Voice.settingInt("shareFps", 30) != f) {
            Nexa.settings.patch(buildJsonObject {
                put("voice", buildJsonObject {
                    put("shareResolution", r)
                    put("shareFps", f)
                })
            })
        }
        Nexa.scope.launch {
            val permission = ScreenConsent.ask() ?: return@launch
            Calls.startScreenShare(permission, r, f)
        }
    }
}

// --- guest links (GuestLinkModal.tsx) ---------------------------------------------------------

/** The address of a guest link: the call's key for the link's epoch in the fragment, which never reaches the server. */
private fun guestCallUrl(code: String, epoch: Int, callKey: ByteArray): String = "${Nexa.api.baseUrl}/call/$code#k=$epoch.${Bytes.b64url(callKey)}"

/** A guest link into a call: this device's own current one while it has an hour left, otherwise a new one. */
private suspend fun guestLinkFor(channelId: String, fresh: Boolean, maxAge: Int?): Pair<String, GuestLink> {
    val conv = Nexa.channels.convFor(channelId)
    val latest = Nexa.keys.ensureConvKey(conv) ?: throw IllegalStateException(t("guestLink.thisConversationSKeysHaveNot"))
    val callKey = Conv.voiceFrameKey(latest.second, channelId)
    if (!fresh) {
        val mine = VoiceApi.guestLinks(channelId).firstOrNull { it.creatorId == Nexa.users.meId && it.epoch == latest.first && it.expiresAt - System.currentTimeMillis() > 60 * 60_000L }
        if (mine != null) return guestCallUrl(mine.code, mine.epoch, callKey) to mine
    }
    val link = VoiceApi.createGuestLink(channelId, latest.first, maxAge)
    return guestCallUrl(link.code, link.epoch, callKey) to link
}

/**
 * Invites people without an account into a call: a link they open, give a
 * name and pass a check, and they are in the call as guests, seeing nothing
 * of the server or the conversation.
 */
fun openGuestLink(channelId: String) {
    val ch = Nexa.channels.get(channelId)
    val managesAll = ch?.serverId == null || ch.type == "dm" || ch.type == "group_dm" ||
        Nexa.servers.get(ch.serverId!!)?.let { st -> Nexa.servers.canI(st, P.MOVE_MEMBERS, channelId) || Nexa.servers.canI(st, P.MANAGE_CHANNELS, channelId) } == true
    val revokeLabel = if (managesAll) t("voice.guestLink.revokeAll") else t("voice.guestLink.revokeMine")
    val ui = GuestLinkUi()
    openSheet("guest-link", title = t("voice.guestLink.inviteGuestsToThisCall"), footer = { close ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ui.confirming) {
                Box(Modifier.weight(1f))
                NxButton(t("chat.editMessage.cancel"), { ui.confirming = false }, kind = ButtonKind.GHOST, enabled = !ui.busy)
                NxButton(revokeLabel, { ui.revoke(channelId) }, kind = ButtonKind.DANGER, enabled = !ui.busy)
            } else {
                // revoking breaks every link already handed out: quiet, at the start, and it asks first
                val interaction = remember { MutableInteractionSource() }
                Box(Modifier.weight(1f)) {
                    Txt(revokeLabel, Modifier.clip(Radii.Sm).pressable(interaction, enabled = !ui.busy) { ui.confirming = true }.padding(horizontal = 8.dp, vertical = 10.dp), style = Nx.type.button, color = Nx.colors.textDanger)
                }
                NxButton(t("modals.serverNotifications.done"), close, kind = ButtonKind.SECONDARY)
            }
        }
    }) {
        val c = Nx.colors
        val scope = rememberCoroutineScope()
        LaunchedEffect(Unit) { ui.load(channelId, fresh = false) }
        Txt(t("voice.guestLink.anyoneWithThisLinkCanJoin"), style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(19.6f)), color = c.textMuted)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NxTextField(
                    ui.url,
                    {},
                    Modifier.weight(1f),
                    label = t("voice.guestLink.guestLink"),
                    placeholder = if (ui.busy) t("voice.guestLink.makingALink") else null,
                    enabled = true,
                )
                NxButton(
                    if (ui.copied) t("modals.groupInvite.copied") else t("modals.groupInvite.copy"),
                    {
                        copy(ui.url)
                        ui.copied = true
                        scope.launch {
                            kotlinx.coroutines.delay(2000)
                            ui.copied = false
                        }
                    },
                    kind = if (ui.copied) ButtonKind.POSITIVE else ButtonKind.PRIMARY,
                    icon = if (ui.copied) "Check" else "Copy",
                    enabled = ui.url.isNotEmpty(),
                )
            }
            ui.expiresAt?.let { Txt(t("voice.guestLink.newGuestsCanUseItUntil", "when" to java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.FULL, java.text.DateFormat.SHORT, fish.nexa.ui.I18n.locale).format(java.util.Date(it))), style = Nx.type.hint, color = c.textMuted) }
        }
        ui.error?.let { Txt(it, style = Nx.type.bodySmall, color = c.textDanger) }
        KeyNote("ShieldCheck", t("voice.guestLink.theCallStaysEndToEnd"), warn = false)
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("voice.guestLink.newLinkExpiresAfter"), style = Nx.type.label, color = c.textSubtle)
            val ages = listOf(3600 to t("modals.customStatus.1Hour"), 21600 to t("modals.invite.6Hours"), 86400 to t("modals.groupInvite.1Day"), 604800 to t("modals.groupInvite.7Days"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                for ((v, label) in ages) {
                    val on = ui.age == v
                    val interaction = remember { MutableInteractionSource() }
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .ring(Radii.Sm, if (on) c.brand.copy(alpha = 0.85f) else c.borderSubtle, if (on) 2.dp else 1.dp)
                            .background(if (on) mixOklab(c.bgSurface, c.brand, 0.14f) else c.bgInput, Radii.Sm)
                            .clip(Radii.Sm)
                            .pressable(interaction, role = Role.RadioButton) { ui.age = v }
                            .semantics { selected = on },
                        contentAlignment = Alignment.Center,
                    ) { Txt(label, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(if (on) 600 else 450)), color = if (on) c.textStrong else c.text, maxLines = 1) }
                }
            }
            NxButton(t("voice.guestLink.newLink"), { scope.launch { ui.load(channelId, fresh = true) } }, kind = ButtonKind.SECONDARY, enabled = !ui.busy)
        }
        if (ui.confirming) KeyNote("TriangleAlert", if (managesAll) t("voice.guestLink.revokeAllWarning") else t("voice.guestLink.revokeMineWarning"), warn = true)
    }
}

@Composable
private fun KeyNote(icon: String, text: String, warn: Boolean) {
    val c = Nx.colors
    val tint = if (warn) c.textWarning else c.statusOnline
    Row(
        Modifier
            .fillMaxWidth()
            .ring(Radii.Sm, tint.copy(alpha = 0.3f))
            .background(mixOklab(c.bgSurface, tint, 0.08f), Radii.Sm)
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, tint, size = 16.dp, modifier = Modifier.padding(top = 2.dp))
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.text)
    }
}

/** The guest link sheet's state. */
private class GuestLinkUi {
    var url by mutableStateOf("")
    var expiresAt by mutableStateOf<Long?>(null)
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    var copied by mutableStateOf(false)
    var age by mutableIntStateOf(86400)
    var confirming by mutableStateOf(false)
    private var seq = 0

    suspend fun load(channelId: String, fresh: Boolean) {
        val n = ++seq
        busy = true
        error = null
        try {
            val (u, link) = guestLinkFor(channelId, fresh, if (fresh) age else null)
            if (n == seq) {
                url = u
                expiresAt = link.expiresAt
            }
        } catch (e: Exception) {
            if (n == seq) error = e.message ?: t("voice.guestLink.couldNotMakeAGuestLink")
        } finally {
            if (n == seq) busy = false
        }
    }

    fun revoke(channelId: String) {
        busy = true
        Nexa.scope.launch {
            try {
                val revoked = VoiceApi.revokeGuestLinks(channelId)
                Nexa.ui.toast(if (revoked > 0) t("voice.guestLink.thoseGuestLinksNoLongerWork") else t("voice.guestLink.thereWereNoGuestLinksTo"), "success")
                confirming = false
                url = ""
                expiresAt = null
                load(channelId, fresh = true)
            } catch (e: Exception) {
                Nexa.ui.toast(e.message ?: t("voice.guestLink.couldNotRevokeTheLinks"), "error")
                busy = false
            }
        }
    }
}
