package xyz.evilion.chat.ui.voice

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.service.CallService
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.theme.chatColors
import xyz.evilion.chat.voice.VoiceEngine
import xyz.evilion.chat.voice.VoiceSession

/**
 * A call, full screen: who is in it, what they are sharing, and the buttons.
 *
 * Nothing here is a picture of a call — the frames are opened on this device
 * with the conversation's key, which is why the readout can say how many were
 * sealed and opened.
 */
@Composable
fun CallScreen(channelId: String, onClose: () -> Unit) {
    val colors = chatColors
    val context = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
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
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            CallService.start(context, channelId, sharing = true)
            VoiceSession.startScreenShare(data)
        }
    }

    // Without the microphone a call still works, one way: you hear everyone and
    // nobody hears you, which is what the web client does when it is refused.
    var asked by remember(channelId) { mutableStateOf(false) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        asked = true
        if (!granted) VoiceSession.noteNoMicrophone()
        if (call.channelId != channelId) VoiceSession.join(channelId)
        CallService.start(context, channelId, sharing = false)
    }

    LaunchedEffect(channelId) {
        if (asked) return@LaunchedEffect
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.RECORD_AUDIO,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) {
            asked = true
            if (call.channelId != channelId) VoiceSession.join(channelId)
            CallService.start(context, channelId, sharing = false)
        } else {
            micPermission.launch(android.Manifest.permission.RECORD_AUDIO)
        }
    }

    val participants = voiceStates.values.filter { it.channelId == channelId }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(colors.bgBase).statusBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Lucide.ChevronDown, "Back to the conversation", tint = colors.icon,
                    modifier = Modifier.size(28.dp).clickable(onClick = onClose),
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        channel?.let { AppState.channelName(it, me?.id) } ?: "Call",
                        color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        when {
                            call.error != null -> call.error!!
                            call.connecting -> "Connecting…"
                            call.connected -> "${participants.size} in the call · encrypted end to end"
                            else -> "Waiting for the call…"
                        },
                        color = if (call.error != null) colors.danger else colors.textMuted,
                        fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            LazyVerticalGrid(
                columns = GridCells.Fixed(if (participants.size <= 2) 1 else 2),
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(participants.size, key = { participants[it].userId }) { index ->
                    val state = participants[index]
                    val mine = state.userId == me?.id
                    val peer = call.peers[state.userId]
                    val track = if (mine) VoiceSession.localVideoTrack() else (peer?.screen ?: peer?.video)
                    val speaking = if (mine) call.speaking else peer?.speaking == true
                    val user = AppState.user(state.userId)

                    Box(
                        Modifier.fillMaxWidth().aspectRatio(1.2f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(colors.bgSurface)
                            .border(2.dp, if (speaking) colors.positive else Color.Transparent, RoundedCornerShape(12.dp))
                            .clickable { if (!mine) VoiceSession.setWatching(state.userId, true) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (track != null) {
                            VideoView(track, mirror = mine)
                        } else {
                            Avatar(
                                state.userId,
                                user?.name ?: state.user?.displayName ?: "?",
                                user?.avatarId ?: state.user?.avatarId,
                                72.dp,
                            )
                        }
                        Row(
                            Modifier.align(Alignment.BottomStart).padding(8.dp)
                                .clip(RoundedCornerShape(8.dp)).background(colors.bgOverlay)
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                if (mine) "You" else AppState.nameFor(state.userId, channel?.serverId),
                                color = Color.White, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            if (state.selfMute || state.serverMute) {
                                Spacer(Modifier.width(4.dp))
                                Icon(Lucide.MicOff, null, tint = colors.danger, modifier = Modifier.size(12.dp))
                            }
                            if (state.selfDeaf || state.serverDeaf) {
                                Spacer(Modifier.width(4.dp))
                                Icon(Lucide.HeadphoneOff, null, tint = colors.danger, modifier = Modifier.size(12.dp))
                            }
                        }
                    }
                }
            }

            if (call.crypto[1] > 0 || call.crypto[0] > 0) {
                Text(
                    "${call.crypto[0]} frames sealed · ${call.crypto[1]} opened" +
                        (if (call.crypto[2] > 0) " · ${call.crypto[2]} dropped" else ""),
                    color = colors.textPlaceholder, fontSize = 10.sp,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CallButton(
                    if (call.muted) Lucide.MicOff else Lucide.Mic,
                    if (call.muted) "Unmute" else "Mute",
                    active = call.muted,
                ) { VoiceSession.setMuted(!call.muted) }
                CallButton(
                    if (call.deafened) Lucide.HeadphoneOff else Lucide.Headphones,
                    if (call.deafened) "Undeafen" else "Deafen",
                    active = call.deafened,
                ) { VoiceSession.setDeafened(!call.deafened) }
                CallButton(
                    if (call.video) Lucide.Video else Lucide.VideoOff,
                    "Camera",
                    active = call.video,
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
                CallButton(
                    if (call.screen) Lucide.MonitorX else Lucide.MonitorUp,
                    "Share screen",
                    active = call.screen,
                ) {
                    if (call.screen) {
                        scope.launch { VoiceSession.stopScreenShare() }
                    } else {
                        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                        screenCapture.launch(manager.createScreenCaptureIntent())
                    }
                }
                CallButton(Lucide.Volume2, "Speaker", active = call.speaker) {
                    VoiceSession.setSpeaker(!call.speaker)
                }
                CallButton(Lucide.Phone, "Leave", danger = true, hangUp = true) {
                    VoiceSession.leave()
                    CallService.stop(context)
                    onClose()
                }
            }
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
    onClick: () -> Unit,
) {
    val colors = chatColors
    Box(
        Modifier.size(52.dp).clip(CircleShape)
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
            modifier = Modifier.size(24.dp).then(if (hangUp) Modifier.rotate(135f) else Modifier),
        )
    }
}

/** A remote or local video track, drawn by WebRTC's own renderer. */
@Composable
fun VideoView(track: VideoTrack, mirror: Boolean = false, modifier: Modifier = Modifier) {
    val renderer = remember(track) { mutableStateOfRenderer() }
    AndroidView(
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                init(VoiceEngine.eglBase.eglBaseContext, null)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setMirror(mirror)
                setEnableHardwareScaler(true)
                track.addSink(this)
                renderer.value = this
            }
        },
        modifier = modifier.fillMaxSize(),
    )
    DisposableEffect(track) {
        onDispose {
            renderer.value?.let { view ->
                runCatching { track.removeSink(view) }
                view.release()
            }
            renderer.value = null
        }
    }
}

private fun mutableStateOfRenderer() = androidx.compose.runtime.mutableStateOf<SurfaceViewRenderer?>(null)
