package fish.nexa.ui.voice

import android.text.format.DateFormat
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.ChatMessage
import fish.nexa.ui.I18n
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.positiveGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import fish.nexa.voice.CallConnection
import fish.nexa.voice.Calls
import fish.nexa.voice.Voice
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Calendar
import java.util.Date

/** Opens the page a call is on: the voice channel, or the conversation. */
fun goToCall(channelId: String) {
    val ch = Nexa.channels.get(channelId) ?: return
    val sid = ch.serverId
    if (sid != null && ch.type != "dm" && ch.type != "group_dm") Nav.go(Route.Server(sid, channelId)) else Nav.go(Route.Dm(channelId))
}

/**
 * "Voice Connected" over the user panel while in a call (VoiceStatus.tsx):
 * how the call is doing, where it is (a tap goes there), noise suppression,
 * hang up, and the camera and screen buttons.
 */
@Composable
fun VoiceStatus() {
    val state by Voice.state.collectAsState()
    val channelId = state.mine?.channelId ?: state.joining ?: return
    val c = Nx.colors
    val reduced = Nx.motion.reduced
    val ease = Nx.motion.easeOut
    val enter = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(260, easing = ease)) }
    val mine = state.mine
    val calling = state.calling != null && state.calling == mine?.channelId
    val reconnecting = mine != null && state.connection == CallConnection.RECONNECTING
    val q = state.quality
    val level = when {
        mine == null || calling -> "unknown"
        reconnecting -> "bad"
        q == null -> "unknown"
        else -> q.level
    }
    val ch = Nexa.channels.get(channelId)
    val server = ch?.serverId?.let { Nexa.servers.get(it) }
    val where = if (server != null && ch.type != "dm" && ch.type != "group_dm") "${ch.name} / ${server.server.name}" else ch?.let { fish.nexa.ui.shell.Names.channel(it) } ?: "…"
    val called = ch?.takeIf { it.type == "dm" }?.recipientIds?.firstOrNull { it != Nexa.users.meId }
    val head = when {
        mine == null -> t("voice.voice.connecting")
        calling -> if (called != null) t("voice.call.callingName", "name" to callName(called, channelId)) else t("voice.call.callingGroup")
        reconnecting -> t("voice.voice.reconnecting")
        state.connection == CallConnection.CONNECTING -> t("voice.voice.connecting")
        else -> t("voice.voiceStatus.voiceConnected")
    }
    val headColor = when {
        mine == null || calling || state.connection == CallConnection.CONNECTING -> c.textMuted
        level == "bad" -> c.textDanger
        level == "ok" -> c.textWarning
        level == "unknown" -> c.textMuted
        else -> c.statusOnline
    }
    val shape = Radii.Md
    Column(
        Modifier
            .fillMaxWidth()
            .graphicsLayer {
                alpha = enter.value
                translationY = (1f - enter.value) * 6f * density
            }
            .shadowMedium(shape, c)
            .ring(shape, c.panelEdge)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .background(Brush.verticalGradient(0f to c.statusOnline.copy(alpha = 0.10f), 0.7f to Color.Transparent), shape)
            .topEdge(shape, c.edgeLight)
            .padding(start = 10.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(if (calling) "PhoneOutgoing" else "Signal", headColor, size = 14.dp)
                    Txt(head, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(700), lineHeight = Nx.type.sp(15.6f)), color = headColor, maxLines = 1)
                }
                val interaction = remember { MutableInteractionSource() }
                Txt(
                    where,
                    Modifier.pressable(interaction) { goToCall(channelId) },
                    style = Nx.type.hint.copy(fontSize = Nx.type.sp(12f), lineHeight = Nx.type.sp(14.4f)),
                    color = c.textMuted,
                    maxLines = 1,
                )
            }
            NoiseButton()
            StatusButton(t("voice.voiceStatus.disconnect"), onClick = { Calls.leave() }) { HangUpIcon(c.textMuted, 18.dp) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            WideButton(
                "Video",
                if (state.localVideo != null) t("voice.voiceStatus.cameraOn") else t("settings.voice.camera"),
                on = state.localVideo != null,
                enabled = mine != null,
                onLongClick = { openCameraMenu() },
                modifier = Modifier.weight(1f),
            ) { Calls.toggleCamera() }
            WideButton(
                "MonitorUp",
                if (state.localScreen != null) t("voice.voiceStatus.sharing") else t("desktop.displayPicker.share"),
                on = state.localScreen != null,
                enabled = mine != null,
                modifier = Modifier.weight(1f),
            ) { if (state.localScreen != null) Calls.stopScreenShare() else openShareScreen() }
        }
    }
}

/** Noise suppression beside hanging up: lit in the accent when RNNoise runs, struck through when off. */
@Composable
private fun NoiseButton() {
    val c = Nx.colors
    val doc by Nexa.settings.doc.collectAsState()
    @Suppress("UNUSED_VARIABLE") val touch = doc.size
    val mode = Voice.setting("noiseMode") ?: "enhanced"
    val label = t("voice.noise.button", "mode" to noiseLabel(mode))
    val tint = if (mode == "enhanced") c.textBrand else c.textMuted
    StatusButton(label, onClick = { openNoiseMenu() }) {
        Box(
            Modifier.drawWithContent {
                drawContent()
                if (mode == "off") {
                    // a stroke across, with a gap of the card's colour round it
                    val a = Offset(size.width * 0.12f, size.height * 0.88f)
                    val b = Offset(size.width * 0.88f, size.height * 0.12f)
                    drawLine(c.bgSurface, a, b, strokeWidth = 6f * density, cap = StrokeCap.Round)
                    drawLine(tint, a, b, strokeWidth = 2f * density, cap = StrokeCap.Round)
                }
            },
        ) { Icon(if (mode == "standard") "AudioLines" else "AudioWaveform", tint, size = 18.dp) }
    }
}

@Composable
private fun StatusButton(label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(32.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgHover else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun WideButton(icon: String, label: String, on: Boolean, enabled: Boolean, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier
            .height(32.dp)
            .clip(Radii.Sm)
            .background(if (on) c.bgActive else if (pressed) c.bgHover else c.bgRaised)
            .pressable(interaction, enabled = enabled, onLongClick = onLongClick, onClick = onClick)
            .graphicsLayer { alpha = if (enabled) 1f else 0.5f },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        Icon(icon, if (on) c.textStrong else c.text, size = 16.dp)
        Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.text, maxLines = 1)
    }
}

// ---------------------------------------------------------------------------

/** At the top of a DM or group while others are in its call and this device is not (CallBanner.tsx). */
@Composable
fun CallBanner(channelId: String, modifier: Modifier = Modifier) {
    val state by Voice.state.collectAsState()
    val byUser by Nexa.voiceStates.byUser.collectAsState()
    val c = Nx.colors
    val me = Nexa.users.meId
    val others = Voice.participants(channelId, byUser).filter { it.userId != me }
    if (others.isEmpty() || state.mine?.channelId == channelId) return
    val joining = state.joining == channelId
    Column {
        Row(
            modifier
                .fillMaxWidth()
                .background(Brush.horizontalGradient(0f to mixOklab(c.bgSurface, c.positive, 0.14f), 1f to c.bgSurface))
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box {
                others.take(5).forEachIndexed { i, p ->
                    Avatar(p.userId, callName(p.userId, channelId), callAvatar(p.userId), 28.dp, modifier = Modifier.offset(x = (22 * i).dp).ring(CircleShape, c.bgSurface, 2.dp))
                }
                Box(Modifier.width((28 + 22 * (minOf(5, others.size) - 1)).dp).height(28.dp))
            }
            Column(Modifier.weight(1f)) {
                Txt(t("voice.callBanner.callInProgress"), style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                Txt(others.joinToString(", ") { callName(it.userId, channelId) }, style = Nx.type.hint, color = c.textMuted, maxLines = 1)
            }
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Row(
                Modifier
                    .height(34.dp)
                    .boxShadow(Radii.Pill, 6f, 16f, c.positive.copy(alpha = 0.9f), spread = -8f)
                    .background(positiveGradient(c), Radii.Pill)
                    .topEdge(Radii.Pill, Color.White.copy(alpha = 0.2f))
                    .clip(Radii.Pill)
                    .pressable(interaction, enabled = !joining) { Calls.join(channelId) }
                    .graphicsLayer { alpha = if (pressed) 0.92f else 1f }
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon("Phone", c.onPositive, size = 14.dp)
                Txt(if (joining) t("voice.callBanner.joining") else t("voice.callBanner.joinCall"), style = Nx.type.buttonSmall.copy(fontWeight = FontWeight(650)), color = c.onPositive, maxLines = 1)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
    }
}

// ---------------------------------------------------------------------------

/** "Today at 4:10 PM", "Yesterday at ...", or the date (lib/time.ts formatTimestamp). */
internal fun formatTimestamp(ms: Long): String {
    val context = Nexa.app
    val time = DateFormat.getTimeFormat(context).format(Date(ms))
    val now = Calendar.getInstance()
    val then = Calendar.getInstance().apply { timeInMillis = ms }
    fun same(a: Calendar, b: Calendar) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    if (same(now, then)) return t("time.todayAt", "time" to time)
    val yesterday = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) }
    if (same(yesterday, then)) return t("time.yesterdayAt", "time" to time)
    val date = java.text.DateFormat.getDateInstance(java.text.DateFormat.SHORT, I18n.locale).format(Date(ms))
    return t("time.dateAt", "date" to date, "time" to time)
}

private const val NAME_MARK = "\u0000"

/**
 * A call's line in a conversation (CallLine.tsx), told from where the reader
 * stands: "Missed call from Alice", "Call with Bob" and how long, "Bob
 * declined your call", from the summary the caller sealed onto the line;
 * without one, that a call was started, and that it is going on while it is.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CallLine(cm: ChatMessage, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val state by Voice.state.collectAsState()
    val byUser by Nexa.voiceStates.byUser.collectAsState()
    val me = Nexa.users.meId
    val channelId = cm.channelId
    val ch = Nexa.channels.get(channelId)
    // a call going on here now is joined from the banner above, not called back
    val busy = state.joining == channelId || state.mine?.channelId == channelId || byUser.values.any { it.channelId == channelId }
    val caller = cm.authorId
    val summary = cm.call
    val dm = ch?.type == "dm"
    val other = if (dm) ch.recipientIds.firstOrNull { it != me } else null
    val o = other ?: caller
    var icon = "Phone"
    var key = "voice.callLine.startedCall"
    var nameArg = "actor"
    var person = caller
    var detail: String? = null
    var tone = "plain"
    var again: String? = null
    if (summary != null && me != null) {
        val outcome = (summary["outcome"] as? JsonPrimitive)?.contentOrNull
        val duration = (summary["duration"] as? JsonPrimitive)?.longOrNull ?: 0L
        val joined = (summary["joined"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
        val declined = (summary["declined"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
        val length = formatCallLength(duration)
        val mine = caller == me
        if (outcome == "answered" && (mine || me in joined || !dm)) {
            tone = "talked"
            if (dm) {
                icon = if (mine) "PhoneOutgoing" else "PhoneIncoming"
                key = "voice.callLine.callWithName"
                nameArg = "name"
                person = o
                detail = length
            } else detail = t("voice.callLine.lasted", "length" to length)
        } else if (mine) {
            again = "again"
            if (dm && outcome == "declined") {
                tone = "declined"
                icon = "PhoneOff"
                key = "voice.callLine.declinedYourCall"
                nameArg = "name"
                person = o
            } else {
                icon = "PhoneOutgoing"
                if (dm) {
                    key = "voice.callLine.youCalledName"
                    nameArg = "name"
                    person = o
                    detail = if (outcome == "cancelled") t("voice.callLine.cancelled") else t("voice.callLine.noAnswer")
                } else detail = t("voice.callLine.noOneJoined")
            }
        } else if (me in declined) {
            again = "back"
            tone = "declined"
            icon = "PhoneOff"
            key = "voice.callLine.youDeclined"
            nameArg = "name"
        } else {
            again = "back"
            tone = "missed"
            icon = "PhoneMissed"
            key = "voice.callLine.missedFrom"
            nameArg = "name"
        }
    } else if (busy) {
        tone = "talked"
        detail = t("voice.callLine.live")
    }
    val (badgeBg, badgeFg, badgeRing) = when (tone) {
        "talked" -> Triple(mixOklab(c.bgSurface, c.positive, 0.16f), c.positive, c.positive.copy(alpha = 0.30f))
        "missed" -> Triple(mixOklab(c.bgSurface, c.danger, 0.16f), c.textDanger, c.danger.copy(alpha = 0.32f))
        else -> Triple(c.bgSurface, c.textMuted, c.borderSubtle)
    }
    val parts = t(key, nameArg to NAME_MARK).split(NAME_MARK)
    Box(modifier.fillMaxWidth().padding(top = 17.dp).padding(start = 64.dp, end = 16.dp, top = 4.dp, bottom = 4.dp)) {
        Box(
            Modifier
                .align(Alignment.CenterStart)
                .offset(x = (-44).dp)
                .size(26.dp)
                .ring(CircleShape, badgeRing)
                .background(badgeBg, CircleShape)
                .topEdge(CircleShape, c.edgeLight),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, badgeFg, size = 16.dp) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val words = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), lineHeight = Nx.type.sp(22f))
                parts.getOrNull(0)?.takeIf { it.isNotEmpty() }?.let { Txt(it, style = words, color = c.text) }
                if (parts.size > 1) {
                    val interaction = remember { MutableInteractionSource() }
                    Txt(fish.nexa.ui.shell.Names.display(Nexa.users.get(person)), Modifier.pressable(interaction) { openProfile(person) }, style = words.copy(fontWeight = FontWeight(500)), color = c.textStrong)
                }
                parts.getOrNull(1)?.takeIf { it.isNotEmpty() }?.let { Txt(it, style = words, color = c.text) }
            }
            detail?.let {
                Box(Modifier.height(22.dp).ring(RoundedCornerShape(11.dp), c.borderSubtle).background(c.bgSurface, RoundedCornerShape(11.dp)).padding(horizontal = 9.dp), contentAlignment = Alignment.Center) {
                    Txt(it, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = if (tone == "talked") mixOklab(c.text, c.positive, 0.7f) else c.textMuted, maxLines = 1)
                }
            }
            Txt(formatTimestamp(cm.m.createdAt), style = Nx.type.timestamp.copy(fontWeight = FontWeight(500), lineHeight = Nx.type.sp(22f)), color = c.textMuted)
            if (again != null && !busy) {
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Row(
                    Modifier
                        .height(40.dp)
                        .ring(RoundedCornerShape(14.dp), if (pressed) Color.Transparent else c.borderSubtle)
                        .background(if (pressed) c.positive else c.bgSurface, RoundedCornerShape(14.dp))
                        .clip(RoundedCornerShape(14.dp))
                        .pressable(interaction) { Calls.join(channelId) }
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon("Phone", if (pressed) Color.White else c.text, size = 14.dp)
                    Txt(if (again == "back") t("voice.callLine.callBack") else t("voice.callLine.callAgain"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = if (pressed) Color.White else c.text, maxLines = 1)
                }
            }
        }
    }
}
