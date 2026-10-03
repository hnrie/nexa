package fish.nexa.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.request.transformations
import coil3.toBitmap
import coil3.transform.CircleCropTransformation
import fish.nexa.MainActivity
import fish.nexa.Nexa
import fish.nexa.R
import androidx.compose.ui.graphics.toArgb
import fish.nexa.data.ChatMessage
import fish.nexa.media.Media
import fish.nexa.net.Channel
import fish.nexa.net.Message
import fish.nexa.net.Relationship
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * lib/notify.ts on Android. Everything is decided here on the device: the
 * server has no push, so alerts come over the live connection (kept open in
 * the background by [ConnectionService]). The app plays its own sounds (the
 * account's sound pack) and posts its notifications silent, one per
 * conversation, as a conversation you can answer from.
 */
object Notifier {
    const val CH_DIRECT = "direct"
    const val CH_MENTIONS = "mentions"
    const val CH_SERVERS = "servers"
    const val CH_REQUESTS = "requests"
    const val CH_NEXA = "nexa"
    const val CH_CONNECTION = "connection"

    const val EXTRA_PATH = "fish.nexa.path"
    const val EXTRA_CHANNEL = "fish.nexa.channel"
    const val KEY_REPLY = "reply"

    /** Plays one of the account's sounds; set once the sound player is ready. */
    var playSound: (String) -> Unit = {}

    /** A message's words as plain text (mentions and formatting read as words). */
    var plainText: (String) -> String = { it.replace(Regex("\\s+"), " ").trim() }

    private data class Line(val authorId: String, val author: String, val avatarId: String?, val text: String, val at: Long)

    /** The lines each conversation's notification shows, newest last, until it is read. */
    private val history = HashMap<String, ArrayDeque<Line>>()

    private fun nm() = NotificationManagerCompat.from(Nexa.app)

    /** Notification channels, named in the app's language (renamed when it changes). */
    fun installChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val m = Nexa.app.getSystemService(NotificationManager::class.java)
        fun channel(id: String, name: String, importance: Int, about: String? = null, vibrate: Boolean = true) =
            NotificationChannel(id, name, importance).apply {
                // the app plays the account's own sounds; the system stays quiet
                setSound(null, null)
                enableVibration(vibrate)
                if (about != null) description = about
                setShowBadge(id != CH_CONNECTION)
            }
        m.createNotificationChannels(
            listOf(
                channel(CH_DIRECT, t("android.notify.channelDirect"), NotificationManager.IMPORTANCE_HIGH),
                channel(CH_MENTIONS, t("android.notify.channelMentions"), NotificationManager.IMPORTANCE_HIGH),
                channel(CH_SERVERS, t("android.notify.channelServers"), NotificationManager.IMPORTANCE_DEFAULT),
                channel(CH_REQUESTS, t("android.notify.channelRequests"), NotificationManager.IMPORTANCE_DEFAULT),
                channel(CH_NEXA, t("android.notify.channelNexa"), NotificationManager.IMPORTANCE_DEFAULT),
                channel(CH_CONNECTION, t("android.notify.channelConnection"), NotificationManager.IMPORTANCE_MIN, t("android.notify.channelConnectionAbout"), vibrate = false),
            ),
        )
    }

    /** The system lets this app post (Android 13 asks), and the account wants app notifications. */
    fun enabled(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(Nexa.app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        if (!nm().areNotificationsEnabled()) return false
        return (Nexa.settings.notifications["app"] as? JsonPrimitive)?.booleanOrNull != false
    }

    private fun soundsOn() = (Nexa.settings.notifications["sounds"] as? JsonPrimitive)?.booleanOrNull != false
    private fun preview() = (Nexa.settings.notifications["preview"] as? JsonPrimitive)?.contentOrNull ?: "full"

    /** lib/dnd.ts: Do Not Disturb silences everything here. */
    private fun doNotDisturb(): Boolean {
        val me = Nexa.users.meId ?: return false
        return Nexa.presence.byId.value[me]?.status == "dnd"
    }

    private fun onScreen() = Nexa.ui.visible.value

    fun serverDefaultLevel(serverId: String): String = if (Nexa.servers.get(serverId)?.server?.defaultNotifications == 1) "mentions" else "all"

    private fun level(id: String?): String? = id?.let { ((Nexa.settings.notifications["perChannel"] as? kotlinx.serialization.json.JsonObject)?.get(it) as? JsonPrimitive)?.contentOrNull }

    /** notify.ts onMessage, step for step. */
    fun onMessage(m: Message, mine: Boolean, dec: ChatMessage) {
        if (mine || m.type.startsWith("system_")) return
        if (m.flags and Message.MSG_FLAG_SUPPRESS_NOTIFICATIONS != 0L) return
        if (Nexa.session.isQuiet(dec)) return
        val me = Nexa.users.me.value ?: return
        val chan = Nexa.channels.get(m.channelId)
        val serverId = chan?.serverId
        val parentId = if (chan?.type == "subchat") chan.parentId else null
        val lvl = level(m.channelId) ?: level(parentId) ?: level(serverId) ?: (if (serverId != null) serverDefaultLevel(serverId) else "all")
        val muted = fish.nexa.ui.shell.Unread.mutedIds()
        if (m.channelId in muted || (parentId != null && parentId in muted) || (serverId != null && serverId in muted) || lvl == "none") return
        val mentioned = Nexa.session.mentionsMe(m, me.id)
        if (lvl == "mentions" && !mentioned) return
        val viewing = Nexa.ui.activeChannel.value == m.channelId
        val screen = onScreen()
        if (screen && viewing) return
        if (doNotDisturb()) return
        if (soundsOn()) playSound(if (mentioned) "mention" else "message")
        if (screen || !enabled()) return
        val path = if (chan?.serverId != null) "/channels/${chan.serverId}/${m.channelId}" else "/channels/@me/${m.channelId}"
        val kind = when {
            chan?.serverId == null -> CH_DIRECT
            mentioned -> CH_MENTIONS
            else -> CH_SERVERS
        }
        val hookName = fish.nexa.data.Webhooks.content(dec.hook)?.name
        val author = hookName ?: Names.display(Nexa.users.get(m.authorId))
        val line = Line(m.authorId, author, if (hookName != null) null else Nexa.users.get(m.authorId)?.avatarId, previewOf(dec), m.createdAt)
        synchronized(history) {
            val list = history.getOrPut(m.channelId) { ArrayDeque() }
            list.addLast(line)
            while (list.size > 6) list.removeFirst()
        }
        Nexa.scope.launch { postConversation(m.channelId, chan, kind, path) }
    }

    /** What a notification may say about a message (notify.ts previewOf). */
    private fun previewOf(dec: ChatMessage): String {
        val p = dec.payload ?: return if (dec.error != null) t("chat.messageItem.encryptedMessage") else t("notify.newMessage")
        p.t?.takeIf { it.isNotBlank() }?.let { return plainText(it).take(140) }
        p.poll?.let { poll -> return (listOf(poll.question) + poll.answers.map { it.text }).joinToString("\n").take(140) }
        p.att?.takeIf { it.isNotEmpty() }?.let { return if (it.size == 1) t("notify.sentFile", "name" to it[0].name) else t("notify.sentFiles", "count" to it.size) }
        if (p.sticker != null) return t("notify.sentASticker")
        return t("notify.newMessage")
    }

    /** Someone's round picture for a notification, or their initials on their colour as the app draws them. */
    private suspend fun avatar(id: String, name: String, avatarId: String?): IconCompat {
        val url = Media.avatarUrl(avatarId, 96, 1f)
        if (url != null) {
            val req = ImageRequest.Builder(Nexa.app).data(url).allowHardware(false).transformations(CircleCropTransformation()).build()
            val res = withTimeoutOrNull(3000) { SingletonImageLoader.get(Nexa.app).execute(req) } as? SuccessResult
            if (res != null) return IconCompat.createWithBitmap(res.image.toBitmap())
        }
        return IconCompat.createWithBitmap(initials(id, name))
    }

    private fun initials(id: String, name: String): Bitmap {
        val size = 192
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bmp)
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        paint.color = fish.nexa.ui.components.AvatarColor.of(id).toArgb()
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        paint.color = android.graphics.Color.WHITE
        paint.textSize = size * 0.42f
        paint.typeface = runCatching { androidx.core.content.res.ResourcesCompat.getFont(Nexa.app, R.font.wix_madefor_display) }.getOrNull()
        paint.isFakeBoldText = true
        paint.textAlign = android.graphics.Paint.Align.CENTER
        val text = fish.nexa.ui.components.AvatarColor.initials(name)
        val y = size / 2f - (paint.descent() + paint.ascent()) / 2f
        canvas.drawText(text, size / 2f, y, paint)
        return bmp
    }

    private fun openIntent(path: String, channelId: String?): PendingIntent {
        val i = Intent(Nexa.app, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            putExtra(EXTRA_PATH, path)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(Nexa.app, (channelId ?: path).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun actionIntent(action: String, channelId: String, mutable: Boolean): PendingIntent {
        val i = Intent(Nexa.app, NotifyActions::class.java).apply {
            this.action = action
            putExtra(EXTRA_CHANNEL, channelId)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
        return PendingIntent.getBroadcast(Nexa.app, (action + channelId).hashCode(), i, flags)
    }

    private fun conversationTitle(chan: Channel?): String? = when {
        chan == null -> null
        chan.type == "group_dm" -> Names.channel(chan)
        chan.serverId != null -> "#${chan.name}"
        else -> null
    }

    /** One notification per conversation (tag ec-<channel>), as a conversation with its latest lines. */
    @android.annotation.SuppressLint("MissingPermission")
    private suspend fun postConversation(channelId: String, chan: Channel?, kind: String, path: String) {
        if (!enabled()) return
        val lines = synchronized(history) { history[channelId]?.toList() } ?: return
        if (lines.isEmpty()) return
        val pv = preview()
        val tag = "ec-$channelId"
        val b = NotificationCompat.Builder(Nexa.app, kind)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(0xFF8000FF.toInt())
            .setContentIntent(openIntent(path, channelId))
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setWhen(lines.last().at)
            .setShowWhen(true)
        // a DM or group is a conversation the system knows by its shortcut (ranked, shown with its person)
        if (chan != null && (chan.type == "dm" || chan.type == "group_dm")) runCatching {
            val name = if (chan.type == "dm") lines.last().author else Names.channel(chan)
            val intent = Intent(Nexa.app, MainActivity::class.java).apply { action = Intent.ACTION_VIEW; putExtra(EXTRA_PATH, path) }
            val sc = androidx.core.content.pm.ShortcutInfoCompat.Builder(Nexa.app, "conv-$channelId")
                .setShortLabel(name.ifBlank { "Nexa" })
                .setLongLived(true)
                .setIntent(intent)
                .setCategories(setOf(fish.nexa.ui.share.Share.SHARE_CATEGORY))
                .setIcon(IconCompat.createWithResource(Nexa.app, R.mipmap.ic_launcher))
                .build()
            androidx.core.content.pm.ShortcutManagerCompat.pushDynamicShortcut(Nexa.app, sc)
            b.setShortcutId("conv-$channelId")
        }
        if (pv == "none") {
            b.setContentTitle("Nexa").setContentText(t("notify.newMessage"))
        } else {
            val me = Nexa.users.me.value
            val self = Person.Builder().setName(me?.name ?: "").setKey(me?.id ?: "me").build()
            val style = NotificationCompat.MessagingStyle(self)
            val title = conversationTitle(chan)
            if (title != null) {
                style.conversationTitle = title
                style.isGroupConversation = true
            }
            val people = HashMap<String, Person>()
            for (l in lines) {
                val words = if (pv == "full") l.text else t("notify.newMessage")
                // your own lines (replies sent from here) are the conversation's own voice
                if (l.authorId == me?.id) {
                    style.addMessage(words, l.at, null as Person?)
                    continue
                }
                val person = people.getOrPut(l.authorId + l.author) {
                    Person.Builder().setName(l.author).setKey(l.authorId).setIcon(avatar(l.authorId, l.author, l.avatarId)).build()
                }
                style.addMessage(words, l.at, person)
            }
            b.setStyle(style)
            // what the lock screen shows: who and where, not what was said
            b.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            b.setPublicVersion(
                NotificationCompat.Builder(Nexa.app, kind).setSmallIcon(R.drawable.ic_notify).setColor(0xFF8000FF.toInt())
                    .setContentTitle("Nexa").setContentText(t("notify.newMessage")).build(),
            )
            val placeholder = when {
                chan?.type == "dm" -> t("composer.composer.messageUser", "name" to lines.last().author)
                chan?.serverId != null -> t("composer.composer.messageChannel", "name" to (chan.name))
                chan != null -> t("composer.composer.messageGroup", "name" to Names.channel(chan))
                else -> t("chat.messageItem.reply")
            }
            val input = RemoteInput.Builder(KEY_REPLY).setLabel(placeholder).build()
            b.addAction(
                NotificationCompat.Action.Builder(R.drawable.ic_notify, t("chat.messageItem.reply"), actionIntent(NotifyActions.REPLY, channelId, mutable = true))
                    .addRemoteInput(input)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false)
                    .build(),
            )
            b.addAction(
                NotificationCompat.Action.Builder(R.drawable.ic_notify, t("sidebar.dmMenu.markAsRead"), actionIntent(NotifyActions.READ, channelId, mutable = false))
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                    .setShowsUserInterface(false)
                    .build(),
            )
        }
        runCatching { nm().notify(tag, 1, b.build()) }
    }

    /** After answering from the notification: the reply joins it, so the system stops waiting. */
    fun addOwnReply(channelId: String, text: String) {
        val me = Nexa.users.me.value ?: return
        synchronized(history) {
            val list = history.getOrPut(channelId) { ArrayDeque() }
            list.addLast(Line(me.id, me.name, me.avatarId, text, System.currentTimeMillis()))
            while (list.size > 6) list.removeFirst()
        }
        val chan = Nexa.channels.get(channelId)
        val kind = if (chan?.serverId == null) CH_DIRECT else CH_SERVERS
        val path = if (chan?.serverId != null) "/channels/${chan.serverId}/$channelId" else "/channels/@me/$channelId"
        Nexa.scope.launch { postConversation(channelId, chan, kind, path) }
    }

    /** Opening or reading a conversation takes its notification away. */
    fun clearConversation(channelId: String) {
        synchronized(history) { history.remove(channelId) }
        runCatching { nm().cancel("ec-$channelId", 1) }
    }

    /** notify.ts onFriendRequest: the friend sound even on screen; a notification only when away. */
    @android.annotation.SuppressLint("MissingPermission")
    fun onFriendRequest(r: Relationship) {
        if (Nexa.users.me.value == null || doNotDisturb()) return
        if (soundsOn()) playSound("friend")
        if (onScreen() || !enabled()) return
        val tag = "ec-friend-${r.user.id}"
        val name = Names.display(r.user)
        Nexa.scope.launch {
            val b = NotificationCompat.Builder(Nexa.app, CH_REQUESTS)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFF8000FF.toInt())
                .setSilent(true)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(openIntent("/channels/@me", null))
            if (preview() == "none") b.setContentTitle("Nexa").setContentText(t("notify.friendRequest"))
            else {
                b.setContentTitle(t("notify.friendRequest")).setContentText(t("notify.sentYouAFriendRequest", "name" to name))
                b.setLargeIcon(avatar(r.user.id, name, r.user.avatarId).toIcon(Nexa.app))
            }
            runCatching { nm().notify(tag, 1, b.build()) }
        }
    }

    /** notify.ts onNoteInvite: someone asking to share a note sounds like a friend request, and notifies while away. */
    @android.annotation.SuppressLint("MissingPermission")
    fun onNoteInvite(inv: fish.nexa.notes.NoteInviteRow) {
        if (Nexa.users.me.value == null || doNotDisturb()) return
        if (soundsOn()) playSound("friend")
        if (onScreen() || !enabled()) return
        val tag = "ec-note-${inv.id}"
        val name = Names.display(inv.from)
        Nexa.scope.launch {
            val b = NotificationCompat.Builder(Nexa.app, CH_REQUESTS)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(0xFF8000FF.toInt())
                .setSilent(true)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(openIntent("/channels/@me/notes", null))
            if (preview() == "none") b.setContentTitle("Nexa").setContentText(t("notify.noteInvite"))
            else {
                b.setContentTitle(t("notify.noteInvite")).setContentText(t("notify.sharedANote", "name" to name))
                b.setLargeIcon(avatar(inv.from.id, name, inv.from.avatarId).toIcon(Nexa.app))
            }
            runCatching { nm().notify(tag, 1, b.build()) }
        }
    }

    /** Other alerts (note requests, Nexa notices, bug replies): a sound and, when away, a plain notification. */
    @android.annotation.SuppressLint("MissingPermission")
    fun simple(tag: String, kind: String, sound: String?, title: String, body: String, path: String, viewingPath: Boolean = false) {
        if (Nexa.users.me.value == null || doNotDisturb()) return
        val screen = onScreen()
        if (screen && viewingPath) return
        if (sound != null && soundsOn()) playSound(sound)
        if (screen || !enabled()) return
        val n = NotificationCompat.Builder(Nexa.app, kind)
            .setSmallIcon(R.drawable.ic_notify)
            .setColor(0xFF8000FF.toInt())
            .setSilent(true)
            .setAutoCancel(true)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openIntent(path, null))
            .build()
        runCatching { nm().notify(tag, 1, n) }
    }

    /** Wires the session's alerts to this, once. */
    fun install() {
        installChannels()
        Nexa.session.onMessage = { m, mine, dec -> onMessage(m, mine, dec) }
        Nexa.session.onFriendRequest = { r -> onFriendRequest(r) }
        // the conversations offered in the system's share sheet, once the account's lists are in
        Nexa.scope.launch { Nexa.session.ready.collect { if (it) fish.nexa.ui.share.Share.publishShortcuts() } }
        // the open conversation's notification goes as soon as it is opened
        Nexa.scope.launch { Nexa.ui.activeChannel.collect { id -> if (id != null && Nexa.ui.visible.value) clearConversation(id) } }
        Nexa.scope.launch { Nexa.ui.visible.collect { v -> if (v) Nexa.ui.activeChannel.value?.let { clearConversation(it) } } }
    }
}
