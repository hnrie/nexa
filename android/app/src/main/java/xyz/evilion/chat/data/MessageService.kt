package xyz.evilion.chat.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import xyz.evilion.chat.App
import xyz.evilion.chat.notify.Notifications
import xyz.evilion.chat.crypto.Aad
import xyz.evilion.chat.crypto.Envelope
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.crypto.Embed
import xyz.evilion.chat.crypto.MessageCrypto
import xyz.evilion.chat.crypto.MessagePayload
import xyz.evilion.chat.crypto.StickerRef
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.AttachmentRef
import xyz.evilion.chat.net.Message
import xyz.evilion.chat.net.MessagesApi
import xyz.evilion.chat.net.PublicUser
import xyz.evilion.chat.net.ReactionSummary
import xyz.evilion.chat.net.ReadState
import xyz.evilion.chat.net.SendMessageRequest
import kotlin.random.Random

/** How many messages a page of history holds. */
private const val PAGE = 50

/** How far a reconnect will walk forward before giving up and reloading the channel. */
private const val MAX_GAP_PAGES = 5

/**
 * Reading and writing messages: fetching history, decrypting it with whatever
 * keys this device holds, and sending with an optimistic copy that is replaced
 * by the server's when it lands.
 */
object MessageService {
    /** Decrypts with the keys in the ring. Never throws. */
    suspend fun decrypt(msg: Message): UiMessage = withContext(Dispatchers.Default) {
        val env = msg.ciphertext ?: return@withContext UiMessage(msg)
        val conv = msg.keyConvId
        val epoch = msg.keyEpoch
        if (conv == null || epoch == null) return@withContext UiMessage(msg, decryptError = "bad")
        val key = KeyService.channelKey(conv, epoch, msg.channelId)
            ?: return@withContext UiMessage(msg, decryptError = "no_key")
        try {
            val payload = MessageCrypto.decrypt(key, env, Aad(conv, epoch, msg.channelId, msg.authorId))
            UiMessage(msg, payload)
        } catch (_: Exception) {
            UiMessage(msg, decryptError = "bad")
        }
    }

    private fun idOf(m: UiMessage): Long = m.raw.id.toLongOrNull() ?: Long.MAX_VALUE

    /** Merges messages into a channel, newest last, without losing pending ones. */
    fun insert(channelId: String, incoming: List<UiMessage>) {
        if (incoming.isEmpty()) return
        val flow = AppState.messages(channelId)
        flow.update { current ->
            val byId = LinkedHashMap<String, UiMessage>(current.size + incoming.size)
            for (m in current) byId[m.id] = m
            for (m in incoming) {
                // a real message replaces the optimistic copy that carried its nonce
                val pending = current.firstOrNull { it.pending && it.raw.nonce != null && it.raw.nonce == m.raw.nonce }
                if (pending != null) byId.remove(pending.id)
                byId[m.id] = m
            }
            byId.values.sortedWith(compareBy({ if (it.pending) 1 else 0 }, { idOf(it) }))
        }
    }

    fun update(channelId: String, message: UiMessage) {
        AppState.messages(channelId).update { list ->
            list.map { if (it.raw.id == message.raw.id) message else it }
        }
    }

    fun remove(channelId: String, id: String) {
        AppState.messages(channelId).update { list -> list.filterNot { it.raw.id == id } }
    }

    fun removeMany(channelId: String, ids: List<String>) {
        val set = ids.toSet()
        AppState.messages(channelId).update { list -> list.filterNot { it.raw.id in set } }
    }

    fun setReaction(channelId: String, messageId: String, emoji: String, add: Boolean, mine: Boolean) {
        AppState.messages(channelId).update { list ->
            list.map { m ->
                if (m.raw.id != messageId) return@map m
                val reactions = m.raw.reactions.toMutableList()
                val at = reactions.indexOfFirst { it.emoji == emoji }
                if (add) {
                    if (at >= 0) {
                        val r = reactions[at]
                        reactions[at] = r.copy(count = r.count + 1, me = r.me || mine)
                    } else {
                        reactions += ReactionSummary(emoji, 1, mine)
                    }
                } else if (at >= 0) {
                    val r = reactions[at]
                    val count = r.count - 1
                    if (count <= 0) reactions.removeAt(at) else reactions[at] = r.copy(count = count, me = r.me && !mine)
                }
                m.copy(raw = m.raw.copy(reactions = reactions))
            }
        }
    }

    fun setFlags(channelId: String, messageId: String, flags: Int) {
        AppState.messages(channelId).update { list ->
            list.map { if (it.raw.id == messageId) it.copy(raw = it.raw.copy(flags = flags)) else it }
        }
    }

    /** Re-reads messages that were waiting for a key that has since arrived. */
    suspend fun redecrypt(convIds: Set<String>) {
        for (channelId in AppState.channels.value.keys) {
            val flow = AppState.messagesOrNull(channelId) ?: continue
            val needs = flow.value.filter { it.decryptError == "no_key" && it.raw.keyConvId in convIds }
            if (needs.isEmpty()) continue
            val fixed = needs.map { decrypt(it.raw) }
            insert(channelId, fixed)
        }
    }

    /**
     * Counts the times a channel's history has been thrown away and reloaded.
     *
     * The first page used to be assigned over whatever was there. Open a
     * channel on a slow connection, write and send before it lands, and the
     * message you just sent is replaced by the page when it arrives — and if
     * the send then fails, its failure is written to a list that no longer
     * holds it, so the text is gone. Anything that arrived meanwhile went the
     * same way. A loader that finds the count has moved on has been overtaken
     * and leaves the list alone.
     */
    private val generations = mutableMapOf<String, Int>()

    private fun generationOf(channelId: String): Int = synchronized(generations) { generations[channelId] ?: 0 }

    /** Marks a channel's history stale, so a loader in flight will not apply. */
    fun bumpGeneration(channelId: String) {
        synchronized(generations) { generations[channelId] = (generations[channelId] ?: 0) + 1 }
    }

    /** The first page of a channel's history. */
    suspend fun loadInitial(channelId: String) {
        val gen = generationOf(channelId)
        val list = MessagesApi.list(channelId, limit = PAGE)
        if (gen != generationOf(channelId)) return
        val decrypted = list.map { decrypt(it) }
        // merged, not assigned: an optimistic message written while this page
        // was on its way is still the only copy of what someone typed
        insert(channelId, decrypted)
        AppState.loadedChannels.update { it + (channelId to (list.size < PAGE)) }
        noteMissingKeys(decrypted)
    }

    /**
     * Fills the hole a dropped connection leaves.
     *
     * Nothing arrives as `message_create` while the socket is down, and a
     * `ready` does not carry history, so without this the messages sent during
     * the gap are simply never seen: leaving the channel and coming back does
     * not help, because it is already marked loaded. Walk forward from what is
     * held until the server has nothing newer, then re-read the newest page so
     * edits, deletes and reactions made during the gap are reconciled too.
     */
    suspend fun syncGap(channelId: String) {
        val gen = generationOf(channelId)
        var newest = AppState.messagesOrNull(channelId)?.value?.lastOrNull { !it.pending }?.raw?.id
        if (newest == null) {
            // nothing held: an ordinary first load is the same thing
            runCatching { loadInitial(channelId) }
            return
        }
        var pages = 0
        while (pages < MAX_GAP_PAGES) {
            val page = MessagesApi.list(channelId, after = newest, limit = PAGE)
            if (gen != generationOf(channelId)) return
            if (page.isEmpty()) break
            val decrypted = page.map { decrypt(it) }
            insert(channelId, decrypted)
            noteMissingKeys(decrypted)
            newest = page.maxByOrNull { it.id.toLongOrNull() ?: Long.MAX_VALUE }?.id ?: break
            pages++
            if (page.size < PAGE) break
        }
        if (pages >= MAX_GAP_PAGES) {
            // too far behind to walk: start the channel again
            bumpGeneration(channelId)
            AppState.loadedChannels.update { it - channelId }
            AppState.messages(channelId).value = emptyList()
            runCatching { loadInitial(channelId) }
            return
        }
        // and pick up what changed rather than what was added
        val refreshed = runCatching { MessagesApi.list(channelId, limit = PAGE) }.getOrNull() ?: return
        if (gen != generationOf(channelId)) return
        insert(channelId, refreshed.map { decrypt(it) })
    }

    /** One page further back; true when the beginning has been reached. */
    suspend fun loadOlder(channelId: String): Boolean {
        val oldest = AppState.messages(channelId).value.firstOrNull { !it.pending }?.raw?.id
        val list = MessagesApi.list(channelId, before = oldest, limit = PAGE)
        val decrypted = list.map { decrypt(it) }
        insert(channelId, decrypted)
        noteMissingKeys(decrypted)
        val atTop = list.size < PAGE
        if (atTop) AppState.loadedChannels.update { it + (channelId to true) }
        return atTop
    }

    private fun noteMissingKeys(list: List<UiMessage>) {
        val waiting = list.mapNotNull { if (it.decryptError == "no_key") it.raw.keyConvId else null }.toSet()
        if (waiting.isNotEmpty()) AppState.waitingForKeys.update { it + waiting }
    }

    class WaitingForKey : Exception(t("messageService.waitingForTheEncryptionKeyFor"))

    /**
     * Encrypts and sends. The optimistic copy shows at once and is replaced by
     * the server's message; if the send fails it stays, marked, so the text is
     * never lost.
     */
    suspend fun send(
        channelId: String,
        text: String,
        replyTo: String? = null,
        ping: Boolean = true,
        attachments: List<AttachmentMeta> = emptyList(),
        attachmentRefs: List<AttachmentRef> = emptyList(),
        sticker: StickerRef? = null,
        embeds: List<Embed> = emptyList(),
        flags: Int? = null,
    ) {
        val me = AppState.me.value ?: return
        val (body, mentions, everyone) = Mentions.extract(text, AppState.users.value.values)
        val payload = MessagePayload(
            text = body.ifEmpty { null },
            attachments = attachments,
            sticker = sticker,
            embeds = embeds,
            flags = flags,
        )
        if (payload.isEmpty) return

        val nonce = newNonce()
        val tmpId = "tmp-$nonce"
        val optimistic = UiMessage(
            raw = Message(
                id = tmpId, channelId = channelId, authorId = me.id,
                type = if (replyTo != null) "reply" else "default",
                replyToId = replyTo, mentions = mentions, nonce = nonce,
                createdAt = System.currentTimeMillis(), flags = flags ?: 0,
            ),
            payload = payload, pending = true, tmpId = tmpId,
        )
        AppState.messages(channelId).update { it + optimistic }

        try {
            val conv = AppState.convFor(channelId)
            val key = KeyService.ensureConvKey(conv) ?: throw WaitingForKey()
            val channelKey = KeyService.channelKey(conv, key.first, channelId) ?: throw WaitingForKey()
            val envelope = MessageCrypto.encrypt(
                channelKey, Aad(conv, key.first, channelId, me.id), payload,
            )
            // Turning the reply ping off silences the person being answered,
            // not everyone the message names: dropping the whole list meant an
            // "@alice look at this" reply reached nobody, which the web client
            // does not do (web/src/components/composer/send.ts).
            val replyAuthor = replyTo?.let { id ->
                AppState.messages(channelId).value.firstOrNull { it.raw.id == id }?.raw?.authorId
            }
            var mentionList = mentions
            if (ping && replyAuthor != null && replyAuthor != me.id && replyAuthor !in mentionList) {
                mentionList = mentionList + replyAuthor
            }
            if (!ping && replyAuthor != null) mentionList = mentionList.filterNot { it == replyAuthor }
            val sent = MessagesApi.send(channelId, SendMessageRequest(
                ciphertext = envelope,
                keyConvId = conv,
                keyEpoch = key.first,
                replyToId = replyTo,
                mentions = mentionList,
                mentionEveryone = if (everyone) true else null,
                attachments = attachmentRefs.ifEmpty { null },
                nonce = nonce,
                flags = flags,
            ))
            val stored = decrypt(sent).let { if (it.payload == null) it.copy(payload = payload, decryptError = null) else it }
            AppState.messages(channelId).update { list -> list.filterNot { it.id == tmpId } }
            insert(channelId, listOf(stored))
            AppState.channels.value[channelId]?.let { AppState.putChannel(it.copy(lastMessageId = sent.id)) }
        } catch (e: Exception) {
            AppState.messages(channelId).update { list ->
                list.map { if (it.id == tmpId) it.copy(pending = false, failed = true) else it }
            }
            throw e
        }
    }

    /** Sends the text of a message that failed, and drops the failed copy. */
    suspend fun retry(channelId: String, tmpId: String) {
        val failed = AppState.messages(channelId).value.firstOrNull { it.id == tmpId } ?: return
        AppState.messages(channelId).update { list -> list.filterNot { it.id == tmpId } }
        send(
            channelId,
            Mentions.humanize(failed.payload?.text.orEmpty(), AppState.users.value),
            replyTo = failed.raw.replyToId,
            attachments = failed.payload?.attachments ?: emptyList(),
            attachmentRefs = failed.payload?.attachments?.map { AttachmentRef(it.blobId, it.size) } ?: emptyList(),
            sticker = failed.payload?.sticker,
        )
    }

    fun dropFailed(channelId: String, tmpId: String) {
        AppState.messages(channelId).update { list -> list.filterNot { it.id == tmpId } }
    }

    suspend fun edit(channelId: String, messageId: String, text: String) {
        val me = AppState.me.value ?: return
        val existing = AppState.messages(channelId).value.firstOrNull { it.raw.id == messageId } ?: return
        val (body, mentions, everyone) = Mentions.extract(text, AppState.users.value.values)
        val payload = (existing.payload ?: MessagePayload()).copy(text = body.ifEmpty { null })
        val conv = existing.raw.keyConvId ?: AppState.convFor(channelId)
        val epoch = existing.raw.keyEpoch ?: KeyService.ring.latest(conv)?.first ?: return
        val key = KeyService.channelKey(conv, epoch, channelId) ?: throw WaitingForKey()
        val envelope = MessageCrypto.encrypt(key, Aad(conv, epoch, channelId, me.id), payload)
        val patch = buildJsonObject {
            put("ciphertext", Api.json.encodeToJsonElement(Envelope.serializer(), envelope))
            putJsonArray("mentions") { for (id in mentions) add(id) }
            if (everyone) put("mention_everyone", true)
        }
        val updated = MessagesApi.edit(channelId, messageId, patch)
        update(channelId, decrypt(updated).let { if (it.payload == null) it.copy(payload = payload, decryptError = null) else it })
    }

    suspend fun delete(channelId: String, messageId: String) {
        MessagesApi.delete(channelId, messageId)
        remove(channelId, messageId)
    }

    suspend fun react(channelId: String, messageId: String, emoji: String, add: Boolean) {
        setReaction(channelId, messageId, emoji, add, true)
        try {
            if (add) MessagesApi.addReaction(channelId, messageId, emoji)
            else MessagesApi.removeReaction(channelId, messageId, emoji)
        } catch (e: ApiException) {
            setReaction(channelId, messageId, emoji, !add, true)
            throw e
        }
    }

    suspend fun ack(channelId: String, messageId: String) {
        val current = AppState.readStates.value[channelId]
        if (current?.lastReadMessageId != null &&
            (current.lastReadMessageId.toLongOrNull() ?: 0) >= (messageId.toLongOrNull() ?: 0)
        ) return
        AppState.putReadState(
            (current ?: ReadState(channelId)).copy(
                lastReadMessageId = messageId, mentionCount = 0, unreadCount = 0,
            ),
        )
        Notifications.clearMessages(App.instance, channelId)
        runCatching { MessagesApi.ack(channelId, messageId) }
    }

    private fun newNonce(): String = buildString {
        val chars = "0123456789abcdef"
        repeat(16) { append(chars[Random.nextInt(16)]) }
    }
}

/** `@username` in what someone typed, and `<@id>` on the wire. */
object Mentions {
    private val SEGMENTS = Regex("(```[\\s\\S]*?```|`[^`\\n]*`|https?://[^\\s<]+)", RegexOption.IGNORE_CASE)
    private val NAME = Regex("(^|[^\\w<])@([a-z0-9_.]{2,32}|everyone|here)\\b")
    private val ID = Regex("<@!?(\\d+)>")

    data class Result(val text: String, val mentions: List<String>, val everyone: Boolean)

    fun extract(text: String, users: Collection<PublicUser>): Result {
        val byName = users.associate { it.username to it.id }
        val mentions = linkedSetOf<String>()
        var everyone = false
        val out = StringBuilder()
        var at = 0
        // code spans and links keep their @ signs
        for (match in SEGMENTS.findAll(text)) {
            out.append(replaceNames(text.substring(at, match.range.first), byName, mentions) { everyone = true })
            out.append(match.value)
            at = match.range.last + 1
        }
        out.append(replaceNames(text.substring(at), byName, mentions) { everyone = true })
        val result = out.toString()
        for (m in ID.findAll(result)) mentions += m.groupValues[1]
        return Result(result, mentions.toList(), everyone)
    }

    private inline fun replaceNames(
        part: String,
        byName: Map<String, String>,
        mentions: MutableSet<String>,
        crossinline onEveryone: () -> Unit,
    ): String = NAME.replace(part) { m ->
        val pre = m.groupValues[1]
        val name = m.groupValues[2]
        if (name == "everyone" || name == "here") {
            onEveryone()
            return@replace m.value
        }
        val id = byName[name] ?: return@replace m.value
        mentions += id
        "$pre<@$id>"
    }

    /** The inverse, for editing: `<@id>` back to `@username` when the user is known. */
    fun humanize(text: String, users: Map<String, PublicUser>): String =
        ID.replace(text) { m -> users[m.groupValues[1]]?.let { "@${it.username}" } ?: m.value }
}
