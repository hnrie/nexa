package fish.nexa.voice

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.ContextCompat
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import fish.nexa.Nexa
import fish.nexa.R
import fish.nexa.media.Media
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * The system notifications of calls (web/src/voice/callNotice.ts, made
 * native): the ongoing call with its controls, an incoming call that rings
 * (CallStyle, full screen over the lock screen) for someone away from the app,
 * and "Missed Call" when one ended with nobody here picking up.
 */
internal object CallNotifications {
    private const val TAG = "CallNotifications"
    const val CHANNEL_CALLS = "calls"
    const val CHANNEL_INCOMING = "incoming_calls"
    const val CHANNEL_MISSED = "missed_calls"
    private const val TAG_RING = "ec-call-"

    private val avatars = java.util.concurrent.ConcurrentHashMap<String, Bitmap>()
    private val looked = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    private fun manager(): NotificationManager = Nexa.app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    /** The channels, named in the app's language (made again with the language). */
    fun init(context: Context) {
        val m = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        m.createNotificationChannel(NotificationChannel(CHANNEL_CALLS, t("android.call.channelCalls"), NotificationManager.IMPORTANCE_LOW).apply {
            setShowBadge(false)
        })
        m.createNotificationChannel(NotificationChannel(CHANNEL_INCOMING, t("android.call.channelIncoming"), NotificationManager.IMPORTANCE_HIGH).apply {
            // the app plays the ring itself, with the account's own ring sound and volume
            setSound(null, null)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 800, 600, 800, 600)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        m.createNotificationChannel(NotificationChannel(CHANNEL_MISSED, t("android.call.channelMissed"), NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun allowed(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(Nexa.app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val n = Nexa.settings.doc.value["notifications"] as? JsonObject
        return (n?.get("app") as? JsonPrimitive)?.booleanOrNull != false
    }

    private fun doNotDisturb(): Boolean = Nexa.users.meId?.let { Nexa.presence.byId.value[it]?.status == "dnd" } == true

    private fun activity(context: Context, action: String, channelId: String?): PendingIntent {
        val i = Intent(context, CallActivity::class.java).setAction(action).putExtra("channel", channelId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        return PendingIntent.getActivity(context, (action + channelId).hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** Someone as the call notifications show them: their picture, or their initial on their colour as the app draws it. */
    private fun person(name: String, id: String?): Person {
        val b = Person.Builder().setName(name).setImportant(true)
        val bmp = id?.let { avatars[it] ?: letterAvatar(it, name) }
        if (bmp != null) b.setIcon(Icon.createWithBitmap(bmp))
        return b.build()
    }

    /** Fetches someone's avatar for the call notifications, once; null-safe and quick to give up. */
    private suspend fun loadAvatar(userId: String) {
        if (avatars.containsKey(userId) || !looked.add(userId)) return
        val id = Nexa.users.get(userId)?.avatarId ?: return
        val url = Media.avatarUrl(id, 96, 2f) ?: return
        val bmp = withTimeoutOrNull(3_000) {
            val res = Media.loader.execute(ImageRequest.Builder(Nexa.app).data(url).allowHardware(false).build())
            ((res as? SuccessResult)?.image as? coil3.BitmapImage)?.bitmap
        } ?: return
        avatars[userId] = circle(bmp)
    }

    /** Avatar.tsx's fallback in a bitmap: the initial in Wix Madefor Display on the id's colour, lit from above. */
    private fun letterAvatar(id: String, name: String): Bitmap {
        val size = 96
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(out)
        val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        p.color = fish.nexa.ui.components.AvatarColor.of(id).toArgb()
        c.drawCircle(size / 2f, size / 2f, size / 2f, p)
        p.shader = android.graphics.LinearGradient(
            0f, 0f, 0f, size.toFloat(),
            intArrayOf(0x1AFFFFFF, 0x00FFFFFF, 0x00000000, 0x38000000),
            floatArrayOf(0f, 0.12f, 0.7f, 1f),
            android.graphics.Shader.TileMode.CLAMP,
        )
        c.drawCircle(size / 2f, size / 2f, size / 2f, p)
        p.shader = null
        p.color = android.graphics.Color.WHITE
        p.textAlign = android.graphics.Paint.Align.CENTER
        p.textSize = size * 0.42f
        val face = runCatching { androidx.core.content.res.ResourcesCompat.getFont(Nexa.app, R.font.wix_madefor_display) }.getOrNull()
        p.typeface = if (face != null && Build.VERSION.SDK_INT >= 28) android.graphics.Typeface.create(face, 660, false) else face
        val text = fish.nexa.ui.components.AvatarColor.initials(name)
        val bounds = android.graphics.Rect()
        p.getTextBounds(text, 0, text.length, bounds)
        c.drawText(text, size / 2f, size / 2f - bounds.exactCenterY(), p)
        return out
    }

    private fun circle(src: Bitmap): Bitmap {
        val size = minOf(src.width, src.height)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(out)
        val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        c.drawCircle(size / 2f, size / 2f, size / 2f, p)
        p.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
        c.drawBitmap(src, ((size - src.width) / 2f), ((size - src.height) / 2f), p)
        return out
    }

    // --- the ongoing call ---------------------------------------------------------

    /** Where the call is, in words: the person, the group, or "channel / server". */
    fun placeOf(channelId: String?): String {
        val ch = channelId?.let { Nexa.channels.get(it) } ?: return ""
        val server = ch.serverId?.let { Nexa.servers.get(it) }
        return if (server != null && ch.type != "dm" && ch.type != "group_dm") "${ch.name} / ${server.server.name}" else Names.channel(ch)
    }

    /** What the call is doing, as the dock says it. */
    fun statusOf(): String {
        val st = Voice.state.value
        val ch = st.mine?.channelId ?: st.joining
        val calling = st.calling != null && st.calling == st.mine?.channelId
        val other = ch?.let { Nexa.channels.get(it) }?.takeIf { it.type == "dm" }?.recipientIds?.firstOrNull { it != Nexa.users.meId }
        return when {
            st.mine == null -> t("voice.voice.connecting")
            calling -> if (other != null) t("voice.call.callingName", "name" to Names.display(Nexa.users.get(other))) else t("voice.call.callingGroup")
            st.connection == CallConnection.RECONNECTING -> t("voice.voice.reconnecting")
            st.connection == CallConnection.CONNECTING -> t("voice.voice.connecting")
            else -> t("voice.voiceStatus.voiceConnected")
        }
    }

    fun ongoing(context: Context): Notification {
        val st = Voice.state.value
        val ch = st.mine?.channelId ?: st.joining
        val place = placeOf(ch)
        val channel = ch?.let { Nexa.channels.get(it) }
        // a DM's call shows the other person; a group or a server shows the place
        val other = channel?.takeIf { it.type == "dm" }?.recipientIds?.firstOrNull { it != Nexa.users.meId }
        if (other != null && !avatars.containsKey(other) && other !in looked) {
            Nexa.scope.launch(Dispatchers.IO) {
                runCatching { loadAvatar(other) }
                if (avatars.containsKey(other)) CallService.update()
            }
        }
        val muted = VoiceLocal.state.value.muted
        val hangUp = CallService.pending(context, CallActionReceiver.ACTION_LEAVE, ch)
        val mute = Notification.Action.Builder(
            Icon.createWithResource(context, if (muted) R.drawable.ic_mic_off else R.drawable.ic_mic),
            if (muted) t("voice.voice.unmute") else t("voice.voice.mute"),
            CallService.pending(context, CallActionReceiver.ACTION_MUTE, ch),
        ).build()
        // how long the call has run, once someone is in it with this device
        val mine = st.mine
        val since = if (mine != null && mine.joinedAt > 0 && st.calling != mine.channelId) mine.joinedAt else null
        val b = Notification.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_call)
            .setContentTitle(place)
            .setContentText(statusOf())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(activity(context, CallActivity.ACTION_OPEN, ch))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        if (since != null) b.setWhen(since).setShowWhen(true).setUsesChronometer(true)
        if (Build.VERSION.SDK_INT >= 31) {
            val placeId = other ?: channel?.serverId ?: ch
            b.setStyle(Notification.CallStyle.forOngoingCall(person(place.ifEmpty { "Nexa" }, placeId), hangUp))
            b.addAction(mute)
        } else {
            b.addAction(mute)
            b.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_call), t("voice.voiceStatus.disconnect"), hangUp).build())
        }
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return b.build()
    }

    fun cancelOngoing() = runCatching { manager().cancel(CallService.NOTIFICATION_ID) }

    // --- ringing ----------------------------------------------------------------------

    /** Rings showing as notifications, so a ring is posted once (posting again would alert again). */
    private val ringsShown = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    /** A call is ringing here: a notification for someone who is not looking at the app (the app rings itself). */
    fun ring(channelId: String, from: String) {
        if (Nexa.ui.visible.value || doNotDisturb() || !allowed()) return
        if (!ringsShown.add(channelId)) return
        Nexa.scope.launch(Dispatchers.IO) {
            runCatching { loadAvatar(from) }
            // answered, declined or gone while the picture came
            if (Voice.ringing.value[channelId] == null || Nexa.ui.visible.value) {
                ringsShown.remove(channelId)
                return@launch
            }
            runCatching { manager().notify(TAG_RING + channelId, 1, incoming(channelId, from)) }.onFailure { Log.w(TAG, "could not show the call", it) }
        }
    }

    private fun incoming(channelId: String, from: String): Notification {
        val context = Nexa.app
        val ch = Nexa.channels.get(channelId)
        val name = Names.display(Nexa.users.get(from))
        val body = if (ch?.type == "group_dm") t("voice.incomingCall.inGroup", "name" to Names.channel(ch)) else t("voice.incomingCall.incomingCall")
        val answer = activity(context, CallActivity.ACTION_ANSWER, channelId)
        val decline = CallService.pending(context, CallActionReceiver.ACTION_DECLINE, channelId)
        val full = activity(context, CallActivity.ACTION_INCOMING, channelId)
        val b = Notification.Builder(context, CHANNEL_INCOMING)
            .setSmallIcon(R.drawable.ic_call)
            .setContentTitle(name)
            .setContentText(body)
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(full)
            .setFullScreenIntent(full, true)
            .setTimeoutAfter(60_000)
        if (Build.VERSION.SDK_INT >= 31) {
            b.setStyle(Notification.CallStyle.forIncomingCall(person(name, from), decline, answer))
        } else {
            b.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_call), t("voice.incomingCall.decline"), decline).build())
            b.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_call), t("voice.incomingCall.accept"), answer).build())
        }
        return b.build()
    }

    /** The call was answered, declined or silenced: its notification goes. */
    fun cancelRing(channelId: String) {
        ringsShown.remove(channelId)
        runCatching { manager().cancel(TAG_RING + channelId, 1) }
    }

    /**
     * A call rang here and ended with nobody on this account picking up.
     * Someone looking at the app is told by a toast; someone away finds
     * "Missed Call" where the ringing was.
     */
    fun missed(channelId: String, from: String) {
        cancelRing(channelId)
        val name = Names.display(Nexa.users.get(from))
        if (Nexa.ui.visible.value) {
            Nexa.ui.toast(t("voice.callLine.missedFrom", "name" to name))
            return
        }
        if (doNotDisturb() || !allowed()) return
        val context = Nexa.app
        val ch = Nexa.channels.get(channelId)
        val body = if (ch?.type == "group_dm") t("voice.callNotice.missedInGroup", "name" to Names.channel(ch)) else t("voice.callNotice.missedCall")
        val n = Notification.Builder(context, CHANNEL_MISSED)
            .setSmallIcon(R.drawable.ic_call)
            .setContentTitle(name)
            .setContentText(body)
            .setCategory(Notification.CATEGORY_MISSED_CALL)
            .setAutoCancel(true)
            .setContentIntent(activity(context, CallActivity.ACTION_OPEN, channelId))
            .apply { avatars[from]?.let { setLargeIcon(it) } }
            .build()
        runCatching { manager().notify(TAG_RING + channelId, 2, n) }
    }
}
