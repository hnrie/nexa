package xyz.evilion.chat.ui.voice

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.VoiceState
import xyz.evilion.chat.service.CallService
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.detached
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.theme.chatColors
import xyz.evilion.chat.voice.CallPeer
import xyz.evilion.chat.voice.VoiceEngine
import xyz.evilion.chat.voice.VoiceSession

/**
 * One rectangle on the call screen: a person, or somebody's screen.
 *
 * A share is its own tile rather than something that hides the face behind it,
 * which is what the web client does and what makes a call with one person
 * sharing readable: you see them and what they are showing at once.
 */
private class Tile(
    val key: String,
    val userId: String,
    val screen: Boolean,
    val mine: Boolean,
    val state: VoiceState,
    val peer: CallPeer?,
    val track: VideoTrack?,
    val speaking: Boolean,
)

/**
 * A call, full screen: who is in it, what they are sharing, and the buttons.
 *
 * Nothing here is a picture of a call — the frames are opened on this device
 * with the conversation's key, which is why the readout can say how many were
 * sealed and opened.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CallScreen(channelId: String, startWithVideo: Boolean = false, onClose: () -> Unit) {
    val colors = chatColors
    val context = LocalContext.current
    val call by VoiceSession.state.collectAsState()
    val channels by AppState.channels.collectAsState()
    val voiceStates by AppState.voiceStates.collectAsState()
    val me by AppState.me.collectAsState()
    val channel = channels[channelId]

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) VoiceSession.toggleCamera()
    }

    val screenCapture = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        // The service is not started here: the projection may not be touched
        // until one of type mediaProjection is really in the foreground, and
        // only the call knows when that has happened.
        if (result.resultCode == Activity.RESULT_OK && data != null) VoiceSession.startScreenShare(data)
    }

    // Without the microphone a call still works, one way: you hear everyone and
    // nobody hears you, which is what the web client does when it is refused.
    var asked by remember(channelId) { mutableStateOf(false) }
    // The video button opens the call with the camera already on; the camera is
    // asked for after the microphone, so the two prompts do not collide.
    var wantsCamera by remember(channelId) { mutableStateOf(false) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        asked = true
        if (!granted) VoiceSession.noteNoMicrophone()
        VoiceSession.join(channelId)
        CallService.start(context, channelId)
        if (startWithVideo) wantsCamera = true
    }

    LaunchedEffect(channelId) {
        if (asked) return@LaunchedEffect
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.RECORD_AUDIO,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) {
            asked = true
            VoiceSession.join(channelId)
            CallService.start(context, channelId)
            if (startWithVideo) wantsCamera = true
        } else {
            micPermission.launch(android.Manifest.permission.RECORD_AUDIO)
        }
    }

    LaunchedEffect(wantsCamera, call.video) {
        if (!wantsCamera) return@LaunchedEffect
        wantsCamera = false
        if (call.video) return@LaunchedEffect
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            VoiceSession.toggleCamera()
        } else {
            cameraPermission.launch(android.Manifest.permission.CAMERA)
        }
    }

    val participants = voiceStates.values
        .filter { it.channelId == channelId }
        .sortedBy { it.joinedAt }
    val tiles = tilesFor(participants, call.peers, me?.id, call.video, call.screen, call.speaking)

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().background(colors.bgBase)) {
            // A landscape phone is barely taller than the header and the
            // buttons together, so the tiles take what is left and scroll
            // rather than pushing the hang-up button off the screen.
            val wide = maxWidth > maxHeight
            val columns = when {
                tiles.size <= 1 -> 1
                maxWidth < 480.dp -> 2
                tiles.size <= 4 -> 2
                else -> 3
            }
            val status = when {
                call.error != null -> call.error.orEmpty()
                call.interrupted -> t("callScreen.pausedForAnotherApp")
                call.connecting -> t("shell.requireAuth.connecting")
                call.connected ->
                    t("voice.voice.inVoiceCount", "count" to participants.size) + " · " + t("callScreen.encryptedEndToEnd")
                else -> t("callScreen.waitingForTheCall")
            }

            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = if (wide) 4.dp else 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Lucide.ChevronDown, t("callScreen.backToTheConversation"), tint = colors.icon,
                        modifier = Modifier.size(40.dp).clip(CircleShape).clickable(onClick = onClose).padding(6.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            channel?.let { AppState.channelName(it, me?.id) } ?: t("services.call"),
                            color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            status,
                            color = if (call.error != null) colors.danger else colors.textMuted,
                            fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                if (tiles.isEmpty()) {
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Text(
                            t("voice.voice.noOneIsHereYet"),
                            color = colors.textMuted, fontSize = 14.sp, textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(columns),
                        modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(tiles, key = { it.key }) { tile ->
                            CallTile(tile, channel?.serverId, wide, tile.userId in call.watching)
                        }
                    }
                }

                if (call.crypto.any) {
                    Text(
                        buildString {
                            append(t("callScreen.framesSealedOpened", "sealed" to call.crypto.sealed, "opened" to call.crypto.opened))
                            if (call.crypto.dropped > 0) {
                                append(" · ")
                                append(t("callScreen.framesDropped", "dropped" to call.crypto.dropped))
                            }
                        },
                        color = colors.textPlaceholder, fontSize = 10.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
                    )
                }

                FlowRow(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = if (wide) 8.dp else 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val size = if (wide) 44.dp else 48.dp
                    CallButton(
                        if (call.muted) Lucide.MicOff else Lucide.Mic,
                        if (call.muted) t("settings.notifications.unmute") else t("settings.notifications.mute"),
                        active = call.muted, size = size,
                    ) { VoiceSession.setMuted(!call.muted) }
                    CallButton(
                        if (call.deafened) Lucide.HeadphoneOff else Lucide.Headphones,
                        if (call.deafened) t("shell.user.undeafen") else t("shell.user.deafen"),
                        active = call.deafened, size = size,
                    ) { VoiceSession.setDeafened(!call.deafened) }
                    CallButton(
                        if (call.video) Lucide.Video else Lucide.VideoOff,
                        if (call.video) t("voice.voice.turnOffCamera") else t("voice.voice.turnOnCamera"),
                        active = call.video, size = size,
                    ) {
                        if (call.video || androidx.core.content.ContextCompat.checkSelfPermission(
                                context, android.Manifest.permission.CAMERA,
                            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                        ) {
                            VoiceSession.toggleCamera()
                        } else {
                            cameraPermission.launch(android.Manifest.permission.CAMERA)
                        }
                    }
                    if (call.video) {
                        CallButton(Lucide.SwitchCamera, t("voice.voice.switchCamera"), size = size) {
                            VoiceSession.switchCamera()
                        }
                    }
                    CallButton(
                        if (call.screen) Lucide.MonitorX else Lucide.MonitorUp,
                        if (call.screen) t("voice.voice.stopSharing") else t("callScreen.shareScreen"),
                        active = call.screen, size = size,
                    ) {
                        if (call.screen) {
                            detached { VoiceSession.stopScreenShare() }
                        } else {
                            val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                            runCatching { screenCapture.launch(manager.createScreenCaptureIntent()) }
                        }
                    }
                    CallButton(Lucide.Volume2, t("settings.voice.speaker"), active = call.speaker, size = size) {
                        VoiceSession.setSpeaker(!call.speaker)
                    }
                    CallButton(Lucide.Phone, t("guestCall.leave"), danger = true, hangUp = true, size = size) {
                        VoiceSession.leave()
                        onClose()
                    }
                }
            }
        }
    }
}

/**
 * What to draw, from the roster and what has actually arrived.
 *
 * The camera is taken from the roster rather than from the track still being
 * held: a sender that is published and sending nothing is exactly what
 * somebody's camera being off looks like now, and the tile should show their
 * face plate, not their last frame frozen.
 */
private fun tilesFor(
    participants: List<VoiceState>,
    peers: Map<String, CallPeer>,
    meId: String?,
    myVideo: Boolean,
    myScreen: Boolean,
    mySpeaking: Boolean,
): List<Tile> {
    val out = mutableListOf<Tile>()
    for (state in participants) {
        val mine = state.userId == meId
        val peer = peers[state.userId]
        val speaking = if (mine) mySpeaking else peer?.speaking == true
        val camera = when {
            mine -> if (myVideo) VoiceSession.localVideoTrack() else null
            state.video -> peer?.video
            else -> null
        }
        out += Tile("p:${state.userId}", state.userId, screen = false, mine = mine, state = state, peer = peer, track = camera, speaking = speaking)
        val sharing = if (mine) myScreen else state.streaming
        if (sharing) {
            val share = if (mine) VoiceSession.localScreenTrack() else peer?.screen
            out += Tile("s:${state.userId}", state.userId, screen = true, mine = mine, state = state, peer = peer, track = share, speaking = false)
        }
    }
    return out
}

@Composable
private fun CallTile(tile: Tile, serverId: String?, compact: Boolean, asked: Boolean) {
    val colors = chatColors
    val user = AppState.user(tile.userId)
    val name = if (tile.mine) t("callScreen.you") else AppState.nameFor(tile.userId, serverId)
    val watching = tile.screen && !tile.mine && asked
    val ring by animateColorAsState(
        if (tile.speaking) colors.positive else Color.Transparent,
        label = "speaking",
    )

    Box(
        Modifier.fillMaxWidth().aspectRatio(if (compact) 1.5f else 1.2f)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.bgSurface)
            .border(2.dp, ring, RoundedCornerShape(12.dp))
            .clickable(enabled = tile.screen && !tile.mine) {
                VoiceSession.setWatching(tile.userId, !watching)
            },
        contentAlignment = Alignment.Center,
    ) {
        val track = tile.track
        if (track != null && (!tile.screen || tile.mine || watching)) {
            VideoView(track, mirror = tile.mine && !tile.screen)
        } else if (tile.screen) {
            // Nobody pays for a share they are not looking at: the pull only
            // starts once this is tapped, which is what the server meters.
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Lucide.MonitorUp, null, tint = colors.icon, modifier = Modifier.size(28.dp))
                Text(
                    if (watching) t("voice.voice.connectingToScreen", "name" to name) else t("voice.voice.watchStream"),
                    color = colors.textMuted, fontSize = 12.sp, textAlign = TextAlign.Center,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
        } else {
            Avatar(
                tile.userId,
                user?.name ?: tile.state.user?.displayName ?: "?",
                user?.avatarId ?: tile.state.user?.avatarId,
                if (compact) 56.dp else 72.dp,
            )
        }

        Row(
            Modifier.align(Alignment.BottomStart).padding(8.dp)
                .clip(RoundedCornerShape(8.dp)).background(colors.bgOverlay)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (tile.screen) {
                    if (tile.mine) t("voice.voice.yourScreen") else t("voice.voice.theirScreen", "name" to name)
                } else {
                    name
                },
                color = Color.White, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (!tile.screen && (tile.state.selfMute || tile.state.serverMute)) {
                Spacer(Modifier.width(4.dp))
                Icon(Lucide.MicOff, null, tint = colors.danger, modifier = Modifier.size(12.dp))
            }
            if (!tile.screen && (tile.state.selfDeaf || tile.state.serverDeaf)) {
                Spacer(Modifier.width(4.dp))
                Icon(Lucide.HeadphoneOff, null, tint = colors.danger, modifier = Modifier.size(12.dp))
            }
        }

        if (tile.screen && !tile.mine && watching) {
            Icon(
                Lucide.EyeOff, t("voice.voice.stopWatching"), tint = Color.White,
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)
                    .size(28.dp).clip(CircleShape).background(colors.bgOverlay).padding(5.dp)
                    .clickable { VoiceSession.setWatching(tile.userId, false) },
            )
        }
    }
}

@Composable
private fun CallButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean = false,
    danger: Boolean = false,
    /** A handset turned down, for the button that ends the call. */
    hangUp: Boolean = false,
    size: Dp = 48.dp,
    onClick: () -> Unit,
) {
    val colors = chatColors
    Box(
        Modifier.size(size).clip(CircleShape)
            .background(
                when {
                    danger -> colors.danger
                    active -> colors.brand
                    else -> colors.bgSurface
                },
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            label,
            tint = if (danger || active) Color.White else colors.icon,
            modifier = Modifier.size(size / 2).then(if (hangUp) Modifier.rotate(135f) else Modifier),
        )
    }
}

/**
 * A remote or local video track, drawn by WebRTC's own renderer.
 *
 * The renderer belongs to the view, not to the track. Keying it on the track
 * meant that someone turning their camera on, or switching between camera and
 * screen share, released the renderer while the `AndroidView` it belonged to
 * carried on living — its factory does not run twice — so the tile went black
 * for the rest of the call, and any frame still on its way to a released
 * native renderer was a crash with no Java stack to show for it. The view is
 * made once and kept; only the sink moves.
 *
 * Every call into the track is guarded, because the track behind a tile can be
 * one the peer connection has just disposed: the call lets go of those first,
 * but a composition already in flight can still be holding the old one.
 */
@Composable
fun VideoView(track: VideoTrack, mirror: Boolean = false, modifier: Modifier = Modifier) {
    val renderer = remember { mutableStateOfRenderer() }
    val attached = remember { mutableStateOfTrack() }
    AndroidView(
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                init(VoiceEngine.eglBase.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                renderer.value = this
            }
        },
        update = { view ->
            view.setMirror(mirror)
            if (attached.value !== track) {
                attached.value?.let { runCatching { it.removeSink(view) } }
                runCatching { track.addSink(view) }
                attached.value = track
            }
        },
        modifier = modifier.fillMaxSize(),
    )
    DisposableEffect(Unit) {
        onDispose {
            val view = renderer.value ?: return@onDispose
            attached.value?.let { runCatching { it.removeSink(view) } }
            attached.value = null
            runCatching { view.release() }
            renderer.value = null
        }
    }
}

private fun mutableStateOfRenderer() = androidx.compose.runtime.mutableStateOf<SurfaceViewRenderer?>(null)

private fun mutableStateOfTrack() = androidx.compose.runtime.mutableStateOf<VideoTrack?>(null)
