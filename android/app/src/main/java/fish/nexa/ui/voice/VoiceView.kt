package fish.nexa.ui.voice

import android.content.Context
import android.content.pm.ActivityInfo
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import fish.nexa.Nexa
import fish.nexa.net.Channel
import fish.nexa.net.VoiceState
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.claimsSideways
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.shell.ChannelGlyph
import fish.nexa.ui.shell.PageHeader
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.dangerGradient
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.positiveGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.topEdge
import fish.nexa.ui.theme.NexaColors
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.voice.AudioRoute
import fish.nexa.voice.CallConnection
import fish.nexa.voice.CallState
import fish.nexa.voice.Calls
import fish.nexa.voice.Engine
import fish.nexa.voice.PeerState
import fish.nexa.voice.Pip
import fish.nexa.voice.Voice
import fish.nexa.voice.VoiceLocal
import org.webrtc.VideoTrack
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** A tile: a share, a person (their camera or their picture), or someone being called. */
@Immutable
internal data class Tile(val key: String, val userId: String, val kind: Kind, val track: VideoTrack?, val me: Boolean) {
    enum class Kind { AVATAR, VIDEO, SCREEN, RINGING }
}

private val GAP = 6.dp
private const val PANEL_KEY = "ec:callPanel"
private const val PANEL_DEFAULT = 0.5f

/** The largest tiles that fit `count` in the box, between 1:1 and 16:9 (callLayout.ts fitGrid). */
private data class Grid(val cols: Int, val width: Float, val height: Float)

private fun fitGrid(count: Int, boxW: Float, boxH: Float, gap: Float, aspect: Float): Grid {
    if (count <= 0 || boxW <= 0 || boxH <= 0) return Grid(0, 0f, 0f)
    var best = Grid(1, 0f, 0f)
    for (cols in 1..count) {
        val rows = ceil(count / cols.toFloat()).toInt()
        val width = min((boxW - gap * (cols - 1)) / cols, ((boxH - gap * (rows - 1)) / rows) * aspect)
        if (width > best.width) best = Grid(cols, width, width / aspect)
    }
    return Grid(best.cols, max(0f, floor(best.width)), max(0f, floor(best.height)))
}

/** A wide stage keeps 16:9; a tall one takes squarer tiles, never narrower than square (gridAspect). */
private fun gridAspect(count: Int, w: Float, h: Float, gap: Float): Float {
    if (count <= 0 || h <= w) return 16f / 9f
    var bestArea = 0f
    var bestAspect = 16f / 9f
    for (cols in 1..count) {
        val rows = ceil(count / cols.toFloat()).toInt()
        val cellW = (w - gap * (cols - 1)) / cols
        val cellH = (h - gap * (rows - 1)) / rows
        val aspect = min(16f / 9f, max(1f, cellW / cellH))
        val tileW = min(cellW, cellH * aspect)
        val area = tileW * tileW / aspect
        if (area > bestArea) {
            bestArea = area
            bestAspect = aspect
        }
    }
    return bestAspect
}

/** The tiles of a call: shares first (what people are there to look at), then everyone, then those being called. */
internal fun tilesOf(channelId: String, state: CallState, participants: List<VoiceState>): List<Tile> {
    val me = Nexa.users.meId
    val out = ArrayList<Tile>()
    for (p in participants) {
        val isMe = p.userId == me
        val screen = if (isMe) state.localScreen else state.remoteScreen[p.userId]
        if (screen != null || (!isMe && p.streaming)) out += Tile("${p.userId}:screen", p.userId, Tile.Kind.SCREEN, screen, isMe)
    }
    for (p in participants) {
        val isMe = p.userId == me
        val video = if (isMe) state.localVideo else state.remoteVideo[p.userId]
        out += Tile("${p.userId}:camera", p.userId, if (video != null) Tile.Kind.VIDEO else Tile.Kind.AVATAR, video, isMe)
    }
    if (state.calling == channelId) {
        val ch = Nexa.channels.get(channelId)
        val waiting = ch?.recipientIds.orEmpty().filter { id -> id != me && participants.none { it.userId == id } }
        for (id in waiting.take(7)) out += Tile("$id:ringing", id, Tile.Kind.RINGING, null, false)
    }
    return out
}

internal fun showsStream(t: Tile, state: CallState): Boolean = t.track != null && (t.kind == Tile.Kind.VIDEO || t.me || t.userId in state.watching)

private fun isLive(t: Tile) = t.kind == Tile.Kind.SCREEN && !t.me

/** The stage's ground: the theme's canvas (its surface colour in a light theme, where the tiles are raised white). */
private fun stageBase(c: NexaColors): Color = if (c.isLight) c.bgSurface else c.bgCanvas

/**
 * The stage wears the theme that is on (Voice.module.css): its canvas, a step
 * below the panels, lit faintly from above in the accent.
 */
private fun Modifier.stageBackground(c: NexaColors): Modifier = drawBehind {
    drawRect(stageBase(c))
    // radial-gradient(120% 70% at 50% -10%, canvas-glow, transparent 72%);
    // the glow's circle starts above the stage, so it is kept to the stage's box
    val ry = size.height * 0.7f
    val rx = size.width * 1.2f
    val center = Offset(size.width / 2f, -size.height * 0.1f)
    clipRect {
        scale(scaleX = rx / ry, scaleY = 1f, pivot = center) {
            drawCircle(
                Brush.radialGradient(0f to c.canvasGlow, 0.72f to Color.Transparent, 1f to Color.Transparent, center = center, radius = ry),
                radius = ry,
                center = center,
            )
        }
    }
}

/**
 * A call (VoiceView.tsx). In a server's voice channel it fills the page,
 * with a lobby before joining; above a DM or group conversation it takes a
 * share of the height (see CallArea). It wears the theme people chose.
 */
@Composable
fun VoiceView(channelId: String, modifier: Modifier = Modifier, embedded: Boolean = false, full: Boolean = false) {
    val state by Voice.state.collectAsState()
    val byUser by Nexa.voiceStates.byUser.collectAsState()
    val connected = state.mine?.channelId == channelId
    if (!connected) Lobby(channelId, state, byUser, modifier)
    else Stage(channelId, state, byUser, modifier, embedded, full)
}

/** ServerPage.tsx's VoiceRoom: a server's voice channel, its header with the channel's glyph, and the call filling the rest. */
@Composable
fun VoiceChannelPage(channel: Channel) {
    // A moderator moved the call to another voice channel of the server while
    // this one was on screen: the screen follows it there, rather than leave
    // its owner looking at the lobby they were taken out of.
    val callAt = Voice.state.collectAsState().value.mine?.channelId
    var callWas by remember { mutableStateOf(callAt) }
    LaunchedEffect(callAt) {
        val was = callWas
        callWas = callAt
        val sid = channel.serverId
        if (sid != null && was == channel.id && callAt != null && callAt != channel.id && Nexa.channels.get(callAt)?.serverId == sid) Nav.go(Route.Server(sid, callAt))
    }
    Column(Modifier.fillMaxSize()) {
        PageHeader(channel.name, icon = { ChannelGlyph(channel, 22.dp, Nx.colors.textMuted) })
        VoiceView(channel.id, Modifier.weight(1f).fillMaxWidth())
    }
}

/** Before joining: who is in there, and one clear way in. */
@Composable
private fun Lobby(channelId: String, state: CallState, byUser: Map<String, VoiceState>, modifier: Modifier) {
    val c = Nx.colors
    val ch = Nexa.channels.get(channelId)
    val participants = Voice.participants(channelId, byUser)
    val joining = state.joining == channelId
    Column(
        modifier
            .fillMaxSize()
            .background(c.bgRaised)
            .drawBehind {
                drawRect(Brush.radialGradient(0f to c.brand.copy(alpha = 0.14f), 0.7f to Color.Transparent, center = Offset(size.width / 2, size.height * 0.3f), radius = max(size.width, size.height) * 0.6f))
            }
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Txt(
            if (ch?.type == "voice") ch.name else t("guestCall.voiceCall"),
            style = Nx.type.title.copy(fontSize = Nx.type.sp(28f), lineHeight = Nx.type.sp(32f), letterSpacing = Nx.type.title.letterSpacing),
            color = c.textStrong,
            align = TextAlign.Center,
        )
        Txt(
            if (participants.isEmpty()) t("voice.voice.noOneIsHereYet") else t("voice.voice.inVoiceCount", "count" to participants.size),
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f)),
            color = c.textMuted,
            align = TextAlign.Center,
        )
        if (participants.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in participants.take(8)) Avatar(p.userId, callName(p.userId, channelId), callAvatar(p.userId), 40.dp)
        }
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        Box(
            Modifier
                .padding(top = 10.dp)
                .height(46.dp)
                .scale(if (pressed && !joining) 0.98f else 1f)
                .alpha(if (joining) 0.6f else 1f)
                .boxShadow(Radii.Pill, 10f, 28f, c.positive.copy(alpha = 0.9f), spread = -10f)
                .background(positiveGradient(c), Radii.Pill)
                .topEdge(Radii.Pill, Color.White.copy(alpha = 0.22f))
                .clip(Radii.Pill)
                .pressable(interaction, enabled = !joining) { Calls.join(channelId) }
                .padding(horizontal = 30.dp),
            contentAlignment = Alignment.Center,
        ) {
            Txt(
                when {
                    joining -> t("voice.voice.connecting")
                    ch?.type == "voice" -> t("voice.voice.joinVoice")
                    else -> t("voice.callBanner.joinCall")
                },
                style = Nx.type.buttonLarge.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(700)),
                color = c.onPositive,
            )
        }
        // the toast that carried this is long gone by the time anyone comes back to the lobby
        state.error?.let { Txt(it, Modifier.widthIn(max = 320.dp), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textDanger, align = TextAlign.Center) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Stage(channelId: String, state: CallState, byUser: Map<String, VoiceState>, modifier: Modifier, embedded: Boolean, full: Boolean) {
    val c = Nx.colors
    val local by VoiceLocal.state.collectAsState()
    val speaking by Voice.speaking.collectAsState()
    val mix by Voice.mix.collectAsState()
    val doc by Nexa.settings.doc.collectAsState()
    @Suppress("UNUSED_VARIABLE") val touch = doc.size
    val ptt = Voice.setting("mode") == "ptt"
    val participants = remember(byUser, channelId) { Voice.participants(channelId, byUser) }
    val tiles = remember(participants, state.localScreen, state.localVideo, state.remoteScreen, state.remoteVideo, state.calling) { tilesOf(channelId, state, participants) }
    val focusedTile = state.focused?.let { k -> tiles.firstOrNull { it.key == k } }
    // a focused tile that has gone (a camera turned off, someone left) lets go of the layout
    LaunchedEffect(state.focused, focusedTile == null) { if (state.focused != null && focusedTile == null) Voice.update { it.copy(focused = null) } }
    var micNoteHidden by remember { mutableStateOf(false) }
    val anyVideo = tiles.any { showsStream(it, state) }
    // a phone showing someone's picture stays awake, the way a video call app does
    KeepScreenOn(anyVideo)
    LaunchedEffect(anyVideo) { AudioRoute.setVideoShowing(anyVideo) }
    DisposableEffect(Unit) {
        Pip.callOnScreen = true
        onDispose { Pip.callOnScreen = false }
    }

    Column(modifier.fillMaxSize().stageBackground(c)) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(GAP)) {
            val stageH = maxHeight
            if (focusedTile != null) {
                val showStrip = tiles.size > 1 && stageH >= 240.dp && focusedTile.kind != Tile.Kind.SCREEN
                Column(verticalArrangement = Arrangement.spacedBy(GAP)) {
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        TileView(focusedTile, channelId, state, byUser, speaking, mix.localMutes, mix.streamMutes, Place.FOCUS, maxWidth, maxHeight)
                    }
                    val strip = androidx.compose.foundation.lazy.rememberLazyListState()
                    if (showStrip) LazyRow(Modifier.fillMaxWidth().height(72.dp).claimsSideways { strip.canScrollForward || strip.canScrollBackward }, state = strip, horizontalArrangement = Arrangement.spacedBy(GAP, Alignment.CenterHorizontally)) {
                        items(tiles.filter { it.key != focusedTile.key }, key = { it.key }) { t ->
                            TileView(t, channelId, state, byUser, speaking, mix.localMutes, mix.streamMutes, Place.STRIP, 128.dp, 72.dp)
                        }
                    }
                }
            } else {
                val w = maxWidth.value
                val h = stageH.value
                val gap = GAP.value
                val grid = fitGrid(tiles.size, w, h, gap, gridAspect(tiles.size, w, h, gap))
                FlowRow(
                    Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.spacedBy(GAP, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(GAP, Alignment.CenterVertically),
                    maxItemsInEachRow = max(1, grid.cols),
                ) {
                    for (t in tiles) androidx.compose.runtime.key(t.key) {
                        TileView(t, channelId, state, byUser, speaking, mix.localMutes, mix.streamMutes, Place.GRID, grid.width.dp, grid.height.dp)
                    }
                }
            }
            // one column of notes over the top of the stage
            Column(Modifier.align(Alignment.TopCenter).padding(top = 6.dp, start = 6.dp, end = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (state.connection == CallConnection.RECONNECTING) StageNote(t("voice.voice.connectionLostReconnecting"), bad = true)
                if (state.micBlocked && !micNoteHidden) MicBlockedNote(onHide = { micNoteHidden = true })
                if (participants.size > 10 && !Calls.throughSfu()) StageNote(t("voice.voice.largeRoomsStrainPeerToPeer"))
                if (state.calling == channelId) {
                    val ch = Nexa.channels.get(channelId)
                    val called = ch?.takeIf { it.type == "dm" }?.recipientIds?.firstOrNull { it != Nexa.users.meId }
                    StageNote(if (called != null) t("voice.call.callingName", "name" to callName(called, channelId)) else t("voice.call.callingGroup"))
                }
                if (state.leftAlone == channelId) {
                    val ch = Nexa.channels.get(channelId)
                    val called = ch?.takeIf { it.type == "dm" }?.recipientIds?.firstOrNull { it != Nexa.users.meId }
                    StageNote(if (called != null) t("voice.call.leftName", "name" to callName(called, channelId)) else t("voice.call.everyoneLeft"))
                }
            }
        }
        if (ptt) HoldToTalk(state.pttHeld)
        Controls(channelId, state, local.muted, local.deafened, embedded, full)
        if (embedded && !full) Spacer(Modifier.height(24.dp)) else Spacer(Modifier.navigationBarsPadding())
    }
}

@Composable
private fun KeepScreenOn(on: Boolean) {
    val activity = LocalActivity.current
    DisposableEffect(on, activity) {
        val w = activity?.window
        if (on) w?.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { if (on) w?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
}

/** What the call has to say (reconnecting, calling, a blocked microphone): frosted pills over the stage. */
@Composable
private fun StageNote(text: String, bad: Boolean = false) {
    val c = Nx.colors
    Box(
        Modifier
            .ring(Radii.Pill, c.panelEdge)
            .background(c.bgFloating.copy(alpha = 0.84f), Radii.Pill)
            .topEdge(Radii.Pill, c.edgeLight)
            .padding(horizontal = 12.dp, vertical = 5.dp)
            .semantics { contentDescription = text },
    ) {
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), lineHeight = Nx.type.sp(18f), fontWeight = if (bad) FontWeight(600) else FontWeight(400)), color = if (bad) c.textDanger else c.textMuted, align = TextAlign.Center)
    }
}

@Composable
private fun MicBlockedNote(onHide: () -> Unit) {
    val c = Nx.colors
    Column(
        Modifier
            .ring(Radii.Md, c.panelEdge)
            .background(c.bgFloating.copy(alpha = 0.84f), Radii.Md)
            .topEdge(Radii.Md, c.edgeLight)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Txt(t("android.call.micBlocked"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), lineHeight = Nx.type.sp(18f)), color = c.textMuted, align = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NoteButton(t("voice.voice.tryAgain")) { Calls.retryMic() }
            NoteButton(t("voice.voice.hideThis"), onHide)
        }
    }
}

@Composable
private fun NoteButton(label: String, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(Modifier.heightIn(min = 36.dp).clip(Radii.Xs).pressable(interaction, onClick = onClick).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline), color = if (pressed) c.textBrand else c.textStrong)
    }
}

internal enum class Place { GRID, FOCUS, STRIP }

/** One tile: a lit card with a person's picture or stream, their name bar, and on the focused one its buttons. */
@Composable
private fun TileView(
    t: Tile,
    channelId: String,
    state: CallState,
    byUser: Map<String, VoiceState>,
    speakingSet: Set<String>,
    localMutes: Set<String>,
    streamMutes: Set<String>,
    place: Place,
    width: Dp,
    height: Dp,
) {
    val c = Nx.colors
    val vs = byUser[t.userId]
    val isSpeaking = t.userId in speakingSet && t.kind != Tile.Kind.SCREEN
    val playing = showsStream(t, state)
    val oversized = !t.me && playing && "${t.userId}:${if (t.kind == Tile.Kind.SCREEN) "screen" else "video"}" in state.tooLarge
    val live = isLive(t)
    val peerState = if (t.me || t.kind == Tile.Kind.RINGING) PeerState.CONNECTED else state.peers[t.userId] ?: PeerState.NEW
    val name = callName(t.userId, channelId)
    val shape = Radii.Md
    val ringAlpha by animateFloatAsState(if (isSpeaking) 1f else 0f, tween(if (isSpeaking) 80 else 240), label = "speaking")
    val serverId = Nexa.channels.get(channelId)?.serverId
    val roleColor = serverId?.let { sid -> Nexa.servers.memberColor(Nexa.servers.get(sid), t.userId)?.let { fish.nexa.ui.theme.rgbColor(it) } }
    val avatarSize = if (place == Place.STRIP) 40.dp else (height.value * 0.36f).coerceIn(40f, 112f).dp
    var zoomed by remember { mutableStateOf(false) }
    // a lit tile of the theme's surface; in a light theme a raised white one
    val surface = if (place == Place.FOCUS) c.bgCanvas else if (c.isLight) c.bgRaised else c.bgSurface

    Box(
        Modifier
            .size(width, height)
            .boxShadow(shape, 12f, 30f, c.shadeAt(0.8f), spread = -16f)
            .ring(shape, c.panelEdge)
            .clip(shape)
            .background(surface)
            .then(if (place != Place.FOCUS && !c.isLight) Modifier.drawBehind {
                drawRect(Brush.radialGradient(0f to mixOklab(c.bgSurface, c.textStrong, 0.04f), 1f to c.bgSurface, center = Offset(size.width * 0.5f, size.height * 0.2f), radius = max(size.width, size.height) * 0.9f))
            } else Modifier)
            .topEdge(shape, c.edgeLight)
            .pointerInput(t.key, place, playing) {
                detectTapGestures(
                    onTap = {
                        if (place != Place.FOCUS) {
                            // focus is only for a picture: an avatar filling the stage had no way back
                            if (playing) Voice.update { s -> s.copy(focused = t.key) }
                        } else if (!zoomed) Voice.update { s -> s.copy(focused = null) }
                    },
                    onLongPress = { tileMenu(t, channelId, state) },
                )
            }
            .semantics { contentDescription = name },
        contentAlignment = Alignment.Center,
    ) {
        when {
            playing && !oversized && t.track != null -> VideoSurface(
                t.track,
                Modifier.fillMaxSize(),
                mirror = t.me && t.kind == Tile.Kind.VIDEO && state.localFront,
                whole = t.kind == Tile.Kind.SCREEN || place == Place.FOCUS,
                zoomable = place == Place.FOCUS,
                onZoom = { zoomed = it },
            )
            oversized -> Offer(t, channelId, place, height, if (t.kind == Tile.Kind.SCREEN) t("voice.voice.screenTooLarge", "name" to name) else t("voice.voice.cameraTooLarge", "name" to name), watching = true, note = true)
            live -> {
                val watching = t.userId in state.watching
                Offer(t, channelId, place, height, if (watching) t("voice.voice.connectingToScreen", "name" to name) else t("voice.voice.isSharingTheirScreen", "name" to name), watching = watching, note = false)
            }
            else -> {
                if (t.kind == Tile.Kind.RINGING) RingingAvatar(t.userId, name, avatarSize)
                else Avatar(t.userId, name, callAvatar(t.userId), avatarSize)
            }
        }
        // the speaking ring comes on quickly and fades gently, so the gaps between words never make it flash
        if (ringAlpha > 0f) Box(
            Modifier
                .fillMaxSize()
                .alpha(ringAlpha)
                .innerShadow(shape, Shadow(radius = 0.dp, spread = 2.5.dp, color = c.statusOnline))
                .innerShadow(shape, Shadow(radius = 22.dp, color = c.statusOnline.copy(alpha = 0.4f))),
        )
        NameBar(t, name, vs, roleColor, place, state, peerState, localMutes, streamMutes, Modifier.align(Alignment.BottomStart))
        if (place == Place.FOCUS && (playing || (t.me && t.kind == Tile.Kind.SCREEN))) TileButtons(t, state, playing, Modifier.align(Alignment.TopEnd))
    }
}

@Composable
private fun RingingAvatar(userId: String, name: String, size: Dp) {
    val c = Nx.colors
    val reduced = Nx.motion.reduced
    val halo = if (reduced) 5f else {
        val pulse = rememberInfiniteTransition(label = "ringing")
        val p by pulse.animateFloat(0f, 1f, infiniteRepeatable(tween(1200, easing = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)), RepeatMode.Restart), label = "halo")
        (if (p < 0.5f) p * 2 else (1 - p) * 2) * 14f
    }
    val alpha = if (reduced) 0.5f else 0.6f * (1f - halo / 14f)
    Avatar(userId, name, callAvatar(userId), size, modifier = Modifier.ring(CircleShape, c.statusOnline.copy(alpha = alpha), halo.dp))
}

/** A screen share someone has not chosen to watch (or one too large to show): their picture, a line, and the button. */
@Composable
private fun Offer(t: Tile, channelId: String, place: Place, height: Dp, text: String, watching: Boolean, note: Boolean) {
    val c = Nx.colors
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.radialGradient(0f to mixOklab(c.bgSurface, c.textStrong, 0.12f), 0.7f to c.bgSurface)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(start = if (place == Place.STRIP) 4.dp else 12.dp, end = if (place == Place.STRIP) 4.dp else 12.dp, top = if (place == Place.STRIP) 4.dp else 12.dp, bottom = if (place == Place.STRIP) 22.dp else 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(if (place == Place.STRIP) 4.dp else 10.dp),
        ) {
            if (place != Place.STRIP && height >= 150.dp) Avatar(t.userId, callName(t.userId, channelId), callAvatar(t.userId), if (height < 220.dp) 40.dp else 56.dp)
            if (place != Place.STRIP && height >= (if (note) 120.dp else 190.dp)) Txt(text, style = Nx.type.bodySmall, color = c.text, maxLines = if (note) 3 else 1, align = TextAlign.Center)
            val small = place == Place.STRIP
            if (watching || t.kind == Tile.Kind.SCREEN && !t.me) WatchButton(
                if (watching) (if (small) t("voice.voice.stop") else t("voice.voice.stopWatching")) else (if (small) t("voice.voice.watch") else t("voice.voice.watchStream")),
                if (watching) "EyeOff" else "Eye",
                small,
            ) { Calls.setWatching(t.userId, !watching) }
        }
    }
}

@Composable
private fun WatchButton(label: String, icon: String, small: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .height(if (small) 32.dp else 44.dp)
            .scale(if (pressed) 0.97f else 1f)
            .boxShadow(Radii.Pill, 6f, 22f, c.brand.copy(alpha = 0.75f), spread = -6f)
            .ring(Radii.Pill, c.brand.copy(alpha = 0.55f))
            .background(brandGradient(c), Radii.Pill)
            .topEdge(Radii.Pill, Color.White.copy(alpha = 0.22f))
            .clip(Radii.Pill)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = if (small) 10.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, c.onBrand, size = 16.dp)
        Txt(label, style = Nx.type.buttonSmall.copy(fontSize = Nx.type.sp(if (small) 12f else 14f), fontWeight = FontWeight(650)), color = c.onBrand, maxLines = 1)
    }
}

/** The frosted name bar at a tile's foot: Live, the name, Guest, and what they have turned off. */
@Composable
private fun NameBar(
    t: Tile,
    name: String,
    vs: VoiceState?,
    roleColor: Color?,
    place: Place,
    state: CallState,
    peerState: PeerState,
    localMutes: Set<String>,
    streamMutes: Set<String>,
    modifier: Modifier,
) {
    val c = Nx.colors
    val strip = place == Place.STRIP
    Row(
        modifier
            .padding(if (strip) 4.dp else 8.dp)
            .ring(Radii.Pill, c.panelEdge)
            .background(c.bgFloating.copy(alpha = 0.8f), Radii.Pill)
            .topEdge(Radii.Pill, c.edgeLight)
            .padding(horizontal = if (strip) 6.dp else 10.dp, vertical = if (strip) 2.dp else 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val fs = if (strip) 11f else 13f
        if (t.kind == Tile.Kind.SCREEN) Tag(t("voice.voice.live"), c.danger, c.onDanger)
        val label = when {
            t.kind != Tile.Kind.SCREEN -> name
            t.me -> t("voice.voice.yourScreen")
            else -> t("voice.voice.theirScreen", "name" to name)
        }
        Txt(label, Modifier.weight(1f, fill = false), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(fs), fontWeight = FontWeight(600)), color = roleColor ?: c.textStrong, maxLines = 1)
        val guest = isGuestUser(t.userId)
        if (t.kind != Tile.Kind.SCREEN && guest) Tag(t("voice.voiceParticipants.guest"), c.bgActive, c.textStrong)
        // their server tag, as beside their name everywhere else
        if (t.kind != Tile.Kind.SCREEN && t.kind != Tile.Kind.RINGING && !guest) (if (t.me) Nexa.users.me.value?.serverTag else Nexa.users.get(t.userId)?.serverTag)?.takeIf { it.text.isNotEmpty() }?.let { fish.nexa.ui.chat.ServerTagChip(it, small = true) }
        // a moderator's mute or deafen in red, wherever the person is shown
        val modMute = vs?.let { VoiceModeration.modMuted(it) } == true
        if (t.kind != Tile.Kind.SCREEN && (vs?.selfMute == true || vs?.serverMute == true || (t.me && state.micBlocked))) Icon("MicOff", if (modMute) c.textDanger else c.textStrong, size = 14.dp)
        if (t.kind != Tile.Kind.SCREEN && (vs?.selfDeaf == true || vs?.serverDeaf == true)) Icon("HeadphoneOff", if (vs?.serverDeaf == true) c.textDanger else c.textStrong, size = 14.dp)
        if (if (t.kind == Tile.Kind.SCREEN) t.userId in streamMutes else t.userId in localMutes) Icon("VolumeX", c.textStrong, size = 14.dp)
        if (t.kind == Tile.Kind.RINGING) Txt(t("voice.voice.ringing"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f)), color = c.textMuted, maxLines = 1)
        if (!t.me && peerState != PeerState.CONNECTED && t.kind != Tile.Kind.SCREEN) Txt(
            if (peerState == PeerState.FAILED || peerState == PeerState.DISCONNECTED) t("voice.voice.reconnecting") else t("voice.voice.connectingEllipsis"),
            style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f)),
            color = c.textWarning,
            maxLines = 1,
        )
    }
}

@Composable
private fun Tag(text: String, bg: Color, fg: Color) {
    Box(Modifier.background(bg, RoundedCornerShape(3.dp)).padding(horizontal = 5.dp)) {
        Txt(text.uppercase(fish.nexa.ui.I18n.locale), style = Nx.type.hint.copy(fontSize = Nx.type.sp(10f), lineHeight = Nx.type.sp(16f), fontWeight = FontWeight(700), letterSpacing = androidx.compose.ui.unit.TextUnit(0.04f, androidx.compose.ui.unit.TextUnitType.Em)), color = fg, maxLines = 1)
    }
}

/** The focused stream's buttons: stop sharing, stop watching, unfocus, picture in picture, full screen. */
@Composable
private fun TileButtons(t: Tile, state: CallState, playing: Boolean, modifier: Modifier) {
    val context = LocalContext.current
    Row(modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (t.me && t.kind == Tile.Kind.SCREEN) TileButton("MonitorX", t("voice.voice.stopSharing")) { Calls.stopScreenShare() }
        if (isLive(t) && t.userId in state.watching) TileButton("EyeOff", t("voice.voice.stopWatching")) { Calls.setWatching(t.userId, false) }
        if (playing) TileButton("Minimize2", t("voice.voice.unfocus")) { Voice.update { it.copy(focused = null) } }
        if (playing) TileButton("PictureInPicture2", t("chat.videoPlayer.pictureInPicture")) {
            if (!Pip.enter()) Nexa.ui.toast(t("voice.voiceView.pictureInPictureCouldNotStart"), "error")
        }
        if (playing && t.track != null) TileButton("Maximize", t("voice.voice.fullScreen")) { openStreamFull(context, t) }
    }
}

@Composable
private fun TileButton(icon: String, label: String, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (pressed) c.brand else c.bgFloating.copy(alpha = 0.8f))
            .topEdge(CircleShape, c.edgeLight)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, if (pressed) c.onBrand else c.textStrong, size = 18.dp) }
}

/** One stream full screen on its own, turned sideways for a wide picture; Back or the button brings it back. */
private fun openStreamFull(context: Context, t: Tile) {
    val track = t.track ?: return
    lateinit var layer: Layer
    layer = Layer("call-stream-full") { close ->
        val activity = LocalActivity.current
        var aspect by remember { mutableFloatStateOf(0f) }
        DisposableEffect(aspect > 1.2f) {
            val before = activity?.requestedOrientation
            if (aspect > 1.2f) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            onDispose { if (before != null) activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
        }
        Immersive()
        DarkScope {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                VideoSurface(track, Modifier.fillMaxSize(), mirror = t.me && t.kind == Tile.Kind.VIDEO && Voice.state.value.localFront, whole = true, zoomable = true, onAspect = { aspect = it })
                Box(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp)) {
                    TileButton("Minimize", t("voice.voice.exitFullScreen")) { close() }
                }
            }
        }
    }
    Layers.open(layer)
}

/** Hides the system bars while shown. */
@Composable
private fun Immersive() {
    val activity = LocalActivity.current
    DisposableEffect(activity) {
        val w = activity?.window
        val ctl = w?.let { WindowCompat.getInsetsController(it, it.decorView) }
        ctl?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        ctl?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { ctl?.show(WindowInsetsCompat.Type.systemBars()) }
    }
}

/** Push to talk on a touch screen: a wide button to hold, above the controls. */
@Composable
private fun HoldToTalk(held: Boolean) {
    val c = Nx.colors
    Box(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .height(56.dp)
                .background(if (held) c.positive else c.bgSurface, RoundedCornerShape(28.dp))
                .pointerInput(Unit) {
                    detectTapGestures(onPress = {
                        Calls.holdToTalk(true)
                        tryAwaitRelease()
                        Calls.holdToTalk(false)
                    })
                }
                .semantics { contentDescription = if (held) t("voice.voice.talking") else t("voice.voice.holdToTalk") },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon("Mic", if (held) c.onPositive else c.textStrong, size = 20.dp)
            Txt(if (held) t("voice.voice.talking") else t("voice.voice.holdToTalk"), style = Nx.type.buttonLarge.copy(fontWeight = FontWeight(600)), color = if (held) c.onPositive else c.textStrong)
        }
    }
}

/**
 * The control bar: one centred group on a dock of glass, sized to the call's
 * width (compact on a phone). Microphone (with its menu), deafen, where the
 * sound plays, camera (with its menu), switch camera, share, full screen and
 * hang up.
 */
@Composable
private fun Controls(channelId: String, state: CallState, muted: Boolean, deafened: Boolean, embedded: Boolean, full: Boolean) {
    val c = Nx.colors
    val route by AudioRoute.current.collectAsState()
    val landscape = LocalConfiguration.current.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
    val canFlip = state.localVideo != null && remember { Engine.cameraCount() } > 1
    BoxWithConstraints(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = if (embedded && !full) 0.dp else 10.dp), contentAlignment = Alignment.Center) {
        val count = 7 + (if (canFlip) 1 else 0)
        val w = maxWidth.value
        val gap = (w * 0.022f).coerceIn(6f, 12f)
        val ctl = floor(max(32f, min(min(if (landscape) 42f else 52f, w * 0.115f), (w - 16 - 16 - (count - 1) * gap) / count))).dp
        Row(
            Modifier
                .boxShadow(Radii.Pill, 16f, 40f, c.shadeAt(0.8f), spread = -16f)
                .ring(Radii.Pill, c.panelEdge)
                .background(c.bgFloating.copy(alpha = 0.72f), Radii.Pill)
                .topEdge(Radii.Pill, c.edgeLight)
                .padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(gap.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // a moderator's mute and deafen hold whatever these buttons say, so the buttons say so
            val modMute = state.mine?.let { VoiceModeration.modMuted(it) } == true
            val modDeaf = state.mine?.serverDeaf == true
            val micLabel = when {
                modMute -> t("voice.moderation.mutedByModerator")
                state.micBlocked -> t("voice.voice.microphoneBlockedTryAgain")
                muted -> t("voice.voice.unmute")
                else -> t("voice.voice.mute")
            }
            ControlButton(if (muted || state.micBlocked || modMute) "MicOff" else "Mic", micLabel, ctl, off = muted || state.micBlocked || modMute, menuLabel = t("voice.voice.microphoneOptions"), onMenu = { openMicMenu() }) {
                when {
                    modMute -> Nexa.ui.toast(t("voice.moderation.mutedHint"))
                    state.micBlocked -> Calls.retryMic()
                    else -> VoiceLocal.toggleMute()
                }
            }
            ControlButton(if (deafened || modDeaf) "HeadphoneOff" else "Headphones", if (modDeaf) t("voice.moderation.deafenedByModerator") else if (deafened) t("voice.voice.undeafen") else t("voice.voice.deafen"), ctl, off = deafened || modDeaf) {
                if (modDeaf) Nexa.ui.toast(t("voice.moderation.deafenedHint")) else VoiceLocal.toggleDeafen()
            }
            ControlButton(routeIcon(route?.kind), t("voice.deviceMenus.outputDevice"), ctl) { openOutputMenu() }
            ControlButton(if (state.localVideo != null) "Video" else "VideoOff", if (state.localVideo != null) t("voice.voice.turnOffCamera") else t("voice.voice.turnOnCamera"), ctl, on = state.localVideo != null, menuLabel = t("voice.voice.cameraOptions"), onMenu = { openCameraMenu() }) { Calls.toggleCamera() }
            if (canFlip) ControlButton("SwitchCamera", t("voice.voice.switchCamera"), ctl) { Calls.flipCamera() }
            ControlButton(if (state.localScreen != null) "MonitorX" else "MonitorUp", if (state.localScreen != null) t("voice.voice.stopSharing") else t("voice.voice.shareYourScreen"), ctl, on = state.localScreen != null) {
                if (state.localScreen != null) Calls.stopScreenShare() else openShareScreen()
            }
            ControlButton(if (full) "Minimize" else "Maximize", if (full) t("chat.videoPlayer.exitFullScreen") else t("chat.videoPlayer.fullScreen"), ctl, on = full) {
                if (full) Layers.stack.lastOrNull { it.key == "call-full" }?.let { l -> l.dismiss?.invoke() ?: Layers.remove(l) } else openCallFull(channelId)
            }
            ControlButton("Phone", t("voice.voiceStatus.disconnect"), ctl, danger = true) { Calls.leave() }
        }
    }
}

internal fun routeIcon(kind: AudioRoute.Kind?): String = when (kind) {
    AudioRoute.Kind.EARPIECE -> "Smartphone"
    AudioRoute.Kind.WIRED, AudioRoute.Kind.USB -> "Headphones"
    AudioRoute.Kind.BLUETOOTH -> "Bluetooth"
    else -> "Volume2"
}

/** A round control: white when on, red when off, the red gradient to hang up, and a small arrow on its corner for its choices. */
@Composable
private fun ControlButton(
    icon: String,
    label: String,
    size: Dp,
    on: Boolean = false,
    off: Boolean = false,
    danger: Boolean = false,
    menuLabel: String? = null,
    onMenu: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val bg = when {
        danger -> Color.Transparent
        // on (camera, sharing): the theme turned over, its text colour as the fill
        on -> if (pressed) mixOklab(c.textStrong, c.bgBase, 0.14f) else c.textStrong
        off -> mixOklab(c.bgSurface, c.danger, if (pressed) 0.34f else 0.24f)
        // a shade towards the text colour: lighter on a dark theme, darker on a light one
        else -> mixOklab(c.bgSurface, c.textStrong, if (pressed) 0.14f else 0.04f)
    }
    val tint = when {
        danger -> c.onDanger
        on -> c.bgBase
        off -> c.textDanger
        else -> c.textStrong
    }
    Box(Modifier.size(size)) {
        Box(
            Modifier
                .fillMaxSize()
                .scale(if (pressed) 0.94f else 1f)
                .then(if (danger) Modifier.boxShadow(CircleShape, 8f, 22f, c.danger.copy(alpha = 0.9f), spread = -8f).background(dangerGradient(c), CircleShape) else Modifier.background(bg, CircleShape))
                .topEdge(CircleShape, if (danger) Color.White.copy(alpha = 0.2f) else c.edgeLight)
                .clip(CircleShape)
                .pressable(interaction, onLongClick = onMenu, onClick = onClick)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            if (danger) HangUpIcon(tint, 20.dp) else Icon(icon, tint, size = 20.dp)
        }
        if (onMenu != null && menuLabel != null) {
            val mi = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 6.dp, y = 4.dp)
                    .size(24.dp)
                    .boxShadow(CircleShape, 1f, 2f, c.shadeAt(0.55f))
                    .background(c.bgCanvas, CircleShape)
                    .padding(2.dp)
                    .background(c.bgFloating, CircleShape)
                    .clip(CircleShape)
                    .pressable(mi, onClick = onMenu)
                    .semantics { contentDescription = menuLabel },
                contentAlignment = Alignment.Center,
            ) { Icon("ChevronUp", c.textStrong, size = 14.dp, stroke = 3f) }
        }
    }
}

/** The call covering the app (a DM's call made to fill the screen). */
private fun openCallFull(channelId: String) {
    Layers.open(Layer("call-full") {
        Immersive()
        Box(Modifier.fillMaxSize().background(stageBase(Nx.colors)).statusBarsPadding()) {
            VoiceView(channelId, Modifier.fillMaxSize(), embedded = false, full = true)
        }
    })
}

// ---------------------------------------------------------------------------
// The call above a conversation

private fun panelShare(context: Context): Float {
    val v = context.getSharedPreferences("voice", Context.MODE_PRIVATE).getFloat(PANEL_KEY, PANEL_DEFAULT)
    return if (v > 0f && v < 1f) v else PANEL_DEFAULT
}

private fun savePanelShare(context: Context, v: Float) = context.getSharedPreferences("voice", Context.MODE_PRIVATE).edit().putFloat(PANEL_KEY, v).apply()

/** Holds a share inside what the space allows; the call's own minimum wins when both cannot fit (callPanel.ts). */
private fun clampPanel(share: Float, container: Float): Float {
    if (container <= 0f) return share
    val min = 150f / container
    val max = max(min, (container - 240f) / container)
    return share.coerceIn(min, max)
}

/**
 * A DM or group conversation with its call: the call above the messages
 * while this device is in it (a share of the height that the grab bar below it
 * sets, remembered on this device; double-tap the bar for half), its banner
 * while others are in it and this device is not, and nothing otherwise.
 * `content` is the conversation (messages and composer).
 */
@Composable
fun CallArea(channelId: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val state by Voice.state.collectAsState()
    val inCall = state.mine?.channelId == channelId || state.joining == channelId
    val context = LocalContext.current
    BoxWithConstraints(modifier.fillMaxSize()) {
        val total = maxHeight.value
        var share by remember { mutableFloatStateOf(panelShare(context)) }
        var dragging by remember { mutableStateOf(false) }
        Column(Modifier.fillMaxSize()) {
            if (inCall) {
                val h = clampPanel(share, total) * total
                Box(Modifier.fillMaxWidth().height(h.dp)) {
                    VoiceView(channelId, Modifier.fillMaxSize(), embedded = true)
                    ResizeHandle(
                        dragging = dragging,
                        modifier = Modifier.align(Alignment.BottomCenter),
                        onStart = { dragging = true },
                        onDrag = { dy -> share = clampPanel(share + dy / total, total) },
                        onEnd = {
                            dragging = false
                            savePanelShare(context, share)
                        },
                        onReset = {
                            share = clampPanel(PANEL_DEFAULT, total)
                            savePanelShare(context, share)
                        },
                    )
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Nx.colors.borderSubtle))
            } else CallBanner(channelId)
            Box(Modifier.weight(1f).fillMaxWidth()) { content() }
        }
    }
}

/** The grab bar between a call and the conversation under it: drag to share the height, double-tap for half. */
@Composable
private fun ResizeHandle(dragging: Boolean, modifier: Modifier, onStart: () -> Unit, onDrag: (Float) -> Unit, onEnd: () -> Unit, onReset: () -> Unit) {
    val c = Nx.colors
    val density = LocalDensity.current.density
    Box(
        modifier
            .fillMaxWidth()
            .height(24.dp)
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { onStart() },
                    onVerticalDrag = { change, dy ->
                        change.consume()
                        onDrag(dy / density)
                    },
                    onDragEnd = onEnd,
                    onDragCancel = onEnd,
                )
            }
            .pointerInput(Unit) { detectTapGestures(onDoubleTap = { onReset() }) }
            .semantics { contentDescription = t("voice.voice.resizeCall") },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(if (dragging) 64.dp else 48.dp, 4.dp)
                .then(if (dragging) Modifier.boxShadow(RoundedCornerShape(2.dp), 0f, 10f, c.brand) else Modifier)
                .background(if (dragging) c.brand else c.borderStrong, RoundedCornerShape(2.dp)),
        )
    }
}

// ---------------------------------------------------------------------------
// Picture in picture

/** The call as it floats: the stage alone, no controls, the speaking rings still lit. */
@Composable
fun PipStage() {
    val state by Voice.state.collectAsState()
    val byUser by Nexa.voiceStates.byUser.collectAsState()
    val speaking by Voice.speaking.collectAsState()
    val mix by Voice.mix.collectAsState()
    val channelId = state.mine?.channelId ?: return
    val participants = Voice.participants(channelId, byUser)
    val tiles = tilesOf(channelId, state, participants)
    // a stream up front if there is one, else everyone
    val lead = tiles.firstOrNull { it.key == state.focused && showsStream(it, state) }
        ?: tiles.firstOrNull { it.kind == Tile.Kind.SCREEN && showsStream(it, state) }
        ?: tiles.firstOrNull { it.kind == Tile.Kind.VIDEO && !it.me }
    run {
        val c = Nx.colors
        BoxWithConstraints(Modifier.fillMaxSize().stageBackground(c).padding(4.dp), contentAlignment = Alignment.Center) {
            if (lead != null) TileView(lead, channelId, state, byUser, speaking, mix.localMutes, mix.streamMutes, Place.GRID, maxWidth, maxHeight)
            else {
                val people = tiles.filter { it.kind != Tile.Kind.SCREEN }.take(4)
                val grid = fitGrid(people.size, maxWidth.value, maxHeight.value, 4f, 1f)
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically), maxItemsInEachRow = max(1, grid.cols)) {
                    for (t in people) TileView(t, channelId, state, byUser, speaking, mix.localMutes, mix.streamMutes, Place.STRIP, grid.width.dp, grid.height.dp)
                }
            }
        }
    }
}
