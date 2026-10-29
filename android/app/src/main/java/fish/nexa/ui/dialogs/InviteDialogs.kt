package fish.nexa.ui.dialogs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.Invites
import fish.nexa.data.P
import fish.nexa.media.Media
import fish.nexa.net.ApiError
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.AvatarColor
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.SelectField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.ToggleRow
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.profile.ProfileTheme
import fish.nexa.ui.profile.copyWithToast
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ---------------------------------------------------------------------------
// InviteModal: a link to a server, with its key

private fun ages() = listOf(
    1800 to t("modals.customStatus.30Minutes"),
    3600 to t("modals.customStatus.1Hour"),
    21600 to t("modals.invite.6Hours"),
    43200 to t("modals.invite.12Hours"),
    86400 to t("modals.groupInvite.1Day"),
    604800 to t("modals.groupInvite.7Days"),
    0 to t("modals.groupInvite.never"),
)

private val USES = listOf(0, 1, 5, 10, 25, 50, 100)

/** The link and its Copy button, the link set in the monospace face. */
@Composable
internal fun LinkRow(link: String, busy: Boolean, copied: Boolean, onCopy: () -> Unit) {
    val c = Nx.colors
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.weight(1f).heightIn(min = 44.dp).sunken(Radii.Sm, c).ring(Radii.Sm, c.borderSubtle).padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (link.isNotEmpty()) Txt(link, style = Nx.type.code.copy(fontSize = Nx.type.sp(13f)), color = c.text, maxLines = 1)
            else if (busy) Txt(t("modals.groupInvite.generating"), style = Nx.type.bodySmall, color = c.textPlaceholder, maxLines = 1)
        }
        NxButton(
            if (copied) t("modals.groupInvite.copied") else t("modals.groupInvite.copy"), onCopy,
            kind = if (copied) ButtonKind.POSITIVE else ButtonKind.PRIMARY,
            icon = if (copied) "Check" else "Copy",
            enabled = link.isNotEmpty(),
            size = ButtonSize.MD,
        )
        // the phone's share sheet, to send the link straight to another app
        val ctx = androidx.compose.ui.platform.LocalContext.current
        NxButton(
            "", {
                val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, link)
                runCatching { ctx.startActivity(android.content.Intent.createChooser(send, t("invite.shareLink"))) }
            },
            kind = ButtonKind.SECONDARY,
            icon = "Share2",
            enabled = link.isNotEmpty(),
            size = ButtonSize.MD,
            modifier = Modifier.semantics { contentDescription = t("invite.shareLink") },
        )
    }
}

@Composable
internal fun InviteSheet(layer: Layer, serverId: String, channelId: String?, close: () -> Unit) {
    val c = Nx.colors
    val servers by Nexa.servers.byId.collectAsState()
    val channels by Nexa.channels.byId.collectAsState()
    val st = servers[serverId]
    val candidates = remember(channels, st) {
        channels.values.filter { it.serverId == serverId && it.type == "text" && Nexa.servers.canI(st, P.CREATE_INSTANT_INVITE, it.id) }
            .sortedWith(compareBy({ it.position }, { it.id.length }, { it.id }))
    }
    var channel by remember { mutableStateOf(channelId?.takeIf { id -> candidates.any { it.id == id } } ?: candidates.firstOrNull()?.id ?: "") }
    var age by remember { mutableIntStateOf(604800) }
    var uses by remember { mutableIntStateOf(0) }
    var withKey by remember { mutableStateOf(true) }
    var invite by remember { mutableStateOf<Invites.Made?>(null) }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    // a server makes its key with its first message; for a new one it is made here, as a first message would
    var key by remember { mutableStateOf(Invites.keyOf(serverId)) }
    var keyBusy by remember { mutableStateOf(key == null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(serverId) {
        if (key != null) return@LaunchedEffect
        try {
            Nexa.keys.ensureConvKey(serverId)
        } catch (_: Exception) {
        }
        key = Invites.keyOf(serverId)
        keyBusy = false
    }
    var pending by remember { mutableStateOf<Job?>(null) }
    // only the newest request fills in the link; a choice settles before a new invite is made
    fun regenerate(ch: String, a: Int, u: Int, wait: Long = 450) {
        pending?.cancel()
        invite = null
        if (ch.isEmpty()) return
        busy = true
        pending = scope.launch {
            delay(wait)
            try {
                invite = Invites.create(ch, a, u)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("modals.groupInvite.couldNotCreateAnInvite")), "error")
            } finally {
                busy = false
            }
        }
    }
    LaunchedEffect(Unit) { regenerate(channel, age, uses, wait = 0) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }
    val made = invite
    val link = made?.let { Invites.url(it.code, if (withKey) key else null) } ?: ""
    val chName = channels[channel]?.name ?: ""
    Sheet(layer, title = t("modals.invite.inviteFriendsTo", "name" to (st?.server?.name ?: t("modals.invite.theServer"))), maxWidth = 480.dp) {
        SelectField(t("modals.invite.inviteToChannel"), candidates.map { it.id to "#${it.name}" }, channel) {
            channel = it
            regenerate(it, age, uses)
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("modals.invite.sendAServerInviteLinkTo"), style = Nx.type.label, color = c.textSubtle)
            LinkRow(link, busy, copied) {
                copyWithToast(link, t("clipboard.copied"))
                copied = true
            }
            if (made != null) {
                val ends = made.expiresAt?.let { t("modals.invite.yourInviteLinkExpiresOn", "when" to Time.full(it)) } ?: t("modals.invite.yourInviteLinkExpiresNever")
                val limit = if (made.maxUses > 0) t("modals.invite.andCanBeUsedTimes", "count" to made.maxUses) else ""
                Txt("$ends$limit.", style = Nx.type.hint, color = c.textMuted)
            }
        }
        // whether the link can carry the key
        Row(
            Modifier.fillMaxWidth().ring(Radii.Sm, c.borderSubtle).background(mixOklab(c.bgFloating, c.bgBase, 0.6f), Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("KeyRound", if (key == null && !keyBusy) c.warning else c.positive, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
            Txt(
                when {
                    key != null -> t("modals.invite.thisLinkCarriesTheServerS")
                    keyBusy -> t("modals.invite.gettingTheKey")
                    else -> t("modals.invite.youDonTHoldThisServer")
                },
                style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)),
                color = c.textMuted,
            )
        }
        ToggleRow(withKey && key != null, { withKey = it }, t("modals.invite.includeTheEncryptionKeyInThe"), enabled = key != null)
        SelectField(t("modals.groupInvite.expireAfter"), ages(), age) {
            age = it
            regenerate(channel, it, uses)
        }
        SelectField(t("modals.groupInvite.maxNumberOfUses"), USES.map { it to if (it == 0) t("modals.invite.noLimit") else t("modals.invite.usesCount", "count" to it) }, uses) {
            uses = it
            regenerate(channel, age, it)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("Hash", c.textMuted, size = 12.dp)
            Txt(if (chName.isNotEmpty()) t("modals.invite.landInChannel", "name" to chName) else t("modals.invite.pickAChannel"), style = Nx.type.hint, color = c.textMuted)
        }
    }
}

// ---------------------------------------------------------------------------
// InviteDialog: an invite link opened in the app

private sealed interface InviteState {
    data object Loading : InviteState
    data object Invalid : InviteState
    data object Failed : InviteState
    data class Ready(val p: Invites.Preview) : InviteState
}

/** The band across the top: the banner, or a strip in the colour of the icon (or of the place's initials). */
@Composable
private fun InviteBand(p: Invites.Preview?) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val c = Nx.colors
    val density = LocalDensity.current.density
    val banner = p?.bannerId?.let { Media.bannerUrl(it, 440, density) }
    var failed by remember(banner) { mutableStateOf(false) }
    if (banner != null && !failed) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 6f).background(c.bgActive)) {
            AsyncImage(banner, null, Media.loader, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, onError = { failed = true })
        }
        return
    }
    val icon = p?.iconId?.let { Media.iconUrl(it, 80, density) }
    val fromIcon = ProfileTheme.rememberDominant(icon)
    val color = fromIcon ?: if (p?.id != null && icon == null) AvatarColor.of(p.id) else c.bgActive
    Box(Modifier.fillMaxWidth().height(64.dp).background(color))
}

/** The band, and the icon set into its lower edge (half over it), ringed in the sheet's own colour. */
@Composable
private fun InviteTop(p: Invites.Preview?) {
    Box(Modifier.fillMaxWidth()) {
        Column {
            InviteBand(p)
            Box(Modifier.height(46.dp))
        }
        InviteIcon(p, Modifier.align(Alignment.BottomStart).padding(start = 18.dp))
    }
}

@Composable
private fun InviteIcon(p: Invites.Preview?, modifier: Modifier) {
    @Suppress("UNUSED_VARIABLE") val mediaAnimationPreferences = fish.nexa.Nexa.settings.doc.collectAsState().value
    val c = Nx.colors
    val density = LocalDensity.current.density
    val url = p?.iconId?.let { Media.iconUrl(it, 80, density) }
    var failed by remember(url) { mutableStateOf(false) }
    val inner = RoundedCornerShape(24.dp)
    Box(
        modifier
            .boxShadow(RoundedCornerShape(30.dp), 10f, 22f, Color.Black.copy(alpha = 0.6f), spread = -12f)
            .background(c.bgFloating, RoundedCornerShape(30.dp))
            .padding(6.dp),
    ) {
        if (url != null && !failed) AsyncImage(url, null, Media.loader, Modifier.size(80.dp).clip(inner), contentScale = ContentScale.Crop, onError = { failed = true })
        else Box(
            Modifier.size(80.dp).background(if (p?.id != null) AvatarColor.of(p.id) else c.bgActive, inner),
            contentAlignment = Alignment.Center,
        ) {
            if (p != null) Txt(AvatarColor.initials(p.name), style = Nx.type.name.copy(fontSize = Nx.type.sp(28.8f), fontWeight = FontWeight(700)), color = Color.White)
        }
    }
}

@Composable
private fun InviteCount(online: Boolean, text: String) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier
                .size(8.dp)
                .then(if (online) Modifier.ring(CircleShape, c.statusOnline.copy(alpha = 0.22f), 3.dp) else Modifier)
                .background(if (online) c.statusOnline else c.statusOffline, CircleShape),
        )
        Txt(text, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18f)), color = c.textMuted)
    }
}

@Composable
private fun InviteNote(icon: String, text: String) {
    val c = Nx.colors
    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, c.textMuted, size = 14.dp, modifier = Modifier.padding(top = 2.dp))
        Txt(text, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.textMuted)
    }
}

/** An invite that leads nowhere any more: expired, used up or deleted. */
@Composable
private fun InviteGone(title: String, body: String, icon: String?) {
    val c = Nx.colors
    Row(Modifier.padding(start = 24.dp, end = 64.dp, top = 24.dp, bottom = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (icon != null) Box(Modifier.size(64.dp).background(c.bgActive, RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) { Icon(icon, c.textMuted, size = 28.dp) }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(title, style = Nx.type.heading.copy(fontSize = Nx.type.sp(20f)), color = c.textStrong, modifier = Modifier.semantics { heading() })
            Txt(body, style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(19.6f)), color = c.textMuted)
        }
    }
}

@Composable
internal fun OpenInviteSheet(layer: Layer, code: String, hash: String, close: () -> Unit) {
    val c = Nx.colors
    var state by remember { mutableStateOf<InviteState>(InviteState.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val channels by Nexa.channels.byId.collectAsState()
    LaunchedEffect(attempt) {
        if (state !is InviteState.Ready) state = InviteState.Loading
        state = try {
            InviteState.Ready(Invites.preview(code))
        } catch (e: ApiError) {
            if (e.status == 404) InviteState.Invalid else InviteState.Failed
        } catch (_: Exception) {
            InviteState.Failed
        }
    }
    val ready = (state as? InviteState.Ready)?.p
    val member = ready?.id != null && (if (ready.group) channels[ready.id] != null else servers[ready.id] != null)
    fun join() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val route = Invites.accept(code, hash)
                close()
                Nav.go(route)
            } catch (e: Exception) {
                // the invite may still be fine, so this stays by the button
                error = describeError(e, t("invite.couldNotAcceptTheInvite"))
            } finally {
                busy = false
            }
        }
    }
    fun open() {
        val p = ready ?: return
        val id = p.id ?: return
        close()
        Nav.go(if (p.group) Route.Dm(id) else Route.Server(id))
    }
    Sheet(layer, maxWidth = 440.dp, closeButton = false, bare = true, padding = 0.dp) {
        Box {
            Column(Modifier.fillMaxWidth()) {
                when (val s = state) {
                    InviteState.Invalid -> {
                        InviteGone(t("invite.invalidInvite"), t("invite.thisInviteIsInvalidOrHasExpired") + " " + t("invite.askForANewOne"), "Link2Off")
                        NxButton(t("chat.attachments.close"), close, kind = ButtonKind.SECONDARY, block = true, modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 24.dp))
                    }
                    InviteState.Failed -> {
                        InviteGone(t("invite.couldNotLoadTheInvite"), t("invite.checkYourConnection"), null)
                        NxButton(t("invite.tryAgain"), { attempt++ }, block = true, modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 24.dp))
                    }
                    InviteState.Loading -> {
                        InviteTop(null)
                        Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.fillMaxWidth(0.55f).height(16.dp).background(c.bgActive, RoundedCornerShape(6.dp)))
                            Box(Modifier.fillMaxWidth(0.4f).height(12.dp).background(c.bgActive, RoundedCornerShape(6.dp)))
                        }
                    }
                    is InviteState.Ready -> {
                        val p = s.p
                        if (p.ageGate) {
                            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                Txt(t("nsfw.warningTitle"), style = Nx.type.heading, color = c.textStrong)
                                Txt(t("nsfw.warningBody"), style = Nx.type.body, color = c.textMuted)
                                NxButton(t("nsfw.confirm"), { Invites.confirmAge(code); attempt += 1 }, block = true)
                                NxButton(t("discovery.close"), close, kind = ButtonKind.GHOST, block = true)
                            }
                        } else {
                        InviteTop(p)
                        Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 24.dp)) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                val inviter = p.inviter
                                fish.nexa.ui.chat.PersonText(
                                    inviter?.id, if (inviter != null) t("invite.invitedYouToJoin", "name" to fish.nexa.ui.chat.PERSON_SLOT) else t("invite.youveBeenInvited"), inviter?.let { it.displayName.ifBlank { it.username } } ?: "",
                                    style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(18.9f)), color = c.textMuted,
                                )
                                Txt(p.name, style = Nx.type.name.copy(fontSize = Nx.type.sp(24f), lineHeight = Nx.type.sp(28.8f), fontWeight = FontWeight(700), letterSpacing = (-0.01).em), color = c.textStrong, modifier = Modifier.semantics { heading() }, maxLines = 2)
                                if (p.online != null || p.members != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    p.online?.let { InviteCount(true, t("invite.onlineCount", "count" to it)) }
                                    p.members?.let { InviteCount(false, if (p.group) t("invite.inThisGroupCount", "count" to it) else t("invite.membersCount", "count" to it)) }
                                }
                            }
                            if (p.description.isNotBlank()) Txt(p.description, style = Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(19.6f)), color = c.text, modifier = Modifier.padding(top = 10.dp), maxLines = 8)
                            Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                if (member) NxButton(if (p.group) t("invite.openGroup") else t("invite.openServer"), ::open, kind = ButtonKind.SECONDARY, size = ButtonSize.LG, block = true)
                                else NxButton(if (p.group) t("invite.joinGroup") else t("invite.joinServer"), ::join, kind = ButtonKind.POSITIVE, size = ButtonSize.LG, block = true, loading = busy)
                                error?.let { Txt(it, style = Nx.type.bodySmall, color = c.textDanger) }
                            }
                            if (!member && hash.contains("k=")) InviteNote("KeyRound", t("invite.thisLinkCarriesTheEncryptionKey"))
                            if (!member && p.group) InviteNote("Lock", t("invite.groupChatsAreEndToEnd"))
                        }
                        }
                    }
                }
            }
            // over the band, or plain where there is none
            CloseButton(plain = state is InviteState.Invalid || state is InviteState.Failed, close)
        }
    }
}

@Composable
private fun BoxScope.CloseButton(plain: Boolean, close: () -> Unit) {
    val c = Nx.colors
    Box(Modifier.align(Alignment.TopEnd).padding(8.dp)) {
        IconButton("X", t("chat.attachments.close"), close, tint = if (plain) c.textMuted else Color.White, iconSize = 18.dp,
            modifier = if (plain) Modifier else Modifier.background(Color.Black.copy(alpha = 0.35f), CircleShape))
    }
}
