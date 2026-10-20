package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Keys
import fish.nexa.crypto.MessagePayload
import fish.nexa.net.AppForm
import fish.nexa.net.ApiError
import fish.nexa.net.CommandChoice
import fish.nexa.net.InteractRequest
import fish.nexa.net.InteractionAnswer
import fish.nexa.net.Message
import fish.nexa.ui.describeError
import fish.nexa.ui.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Using what an app made (web lib/interactions.ts): a command, a button or a
 * select menu on its message, a form it opened. The app sends it to the
 * server, which hands it to the app and waits up to three seconds for its
 * first answer. What the answer made is put in place at once rather than left
 * for the gateway (which brings it too): a message, a changed message, a form
 * to fill in or suggestions for an option.
 *
 * When the app does not answer, or answers with something that cannot be
 * shown, a line only this person sees says so in the conversation, under the
 * app's name, where they were looking.
 */
object Interactions {
    // answer types
    const val ANSWER_MESSAGE = 4
    const val ANSWER_THINKING = 5
    const val ANSWER_LATER = 6
    const val ANSWER_UPDATE = 7
    const val ANSWER_CHOICES = 8
    const val ANSWER_FORM = 9

    /** What an interaction came to: the app's answer, or the sentence for what went wrong. */
    sealed interface Outcome {
        data class Ok(val answer: InteractionAnswer) : Outcome
        data class Failed(val error: String) : Outcome
    }

    /** Where a form was opened from, to send its answer back. */
    data class FormAt(val interactionId: String, val appId: String, val channelId: String)

    /** Opens an app's form; set by the screens (ui/apps/AppForm). */
    @Volatile var formOpener: ((AppForm, FormAt) -> Unit)? = null

    /** The sentence for an interaction that failed, naming the app. */
    fun errorText(err: Throwable, appName: String): String {
        if (err is ApiError) when (err.code) {
            "app_unavailable" -> return t("apps.use.notConnected", "app" to appName)
            "app_no_response" -> return t("apps.use.noResponse", "app" to appName)
            "app_bad_response" -> return t("apps.use.badResponse", "app" to appName)
            "unknown_interaction" -> return t("apps.use.expired")
        }
        return describeError(err, t("apps.use.failed", "app" to appName))
    }

    /** The app's name as its bot goes by. */
    fun appName(appId: String): String = Nexa.users.get(appId)?.name?.takeIf { it.isNotBlank() } ?: t("apps.anApp")

    /** Puts what an answer made in its place in the conversation. */
    private suspend fun place(message: Message?, changed: Boolean) {
        if (message == null) return
        val msg = withContext(Dispatchers.Default) { Nexa.messages.decrypt(message) }
        if (changed) Nexa.messages.update(message.channelId, msg) else Nexa.messages.insert(message.channelId, listOf(msg))
    }

    /**
     * Sends an interaction and puts its answer in place. A form the app opens
     * is opened here; suggestions are handed back. A failure is said in the
     * conversation (`quiet` leaves it to the caller, for suggestions typed
     * into a command, where it would only get in the way).
     */
    suspend fun interact(req: InteractRequest, quiet: Boolean = false): Outcome {
        val name = appName(req.applicationId)
        return try {
            val answer = Apps.interact(req.copy(locale = AppCommands.protocolLocale()))
            when (answer.type) {
                ANSWER_MESSAGE, ANSWER_THINKING -> place(answer.message, false)
                ANSWER_UPDATE -> place(answer.message, true)
                ANSWER_FORM -> answer.modal?.let { form -> withContext(Dispatchers.Main) { formOpener?.invoke(form, FormAt(answer.id, req.applicationId, req.channelId)) } }
                ANSWER_CHOICES, ANSWER_LATER -> Unit
                // something this server never shows (an activity, a purchase)
                else -> if (!quiet) localNotice(req.channelId, req.applicationId, t("apps.use.unsupported", "app" to name))
            }
            Outcome.Ok(answer)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            val error = errorText(e, name)
            if (!quiet) localNotice(req.channelId, req.applicationId, error)
            Outcome.Failed(error)
        }
    }

    /** Suggestions an app gave for an option being typed, or none. */
    fun choicesOf(o: Outcome): List<CommandChoice> = (o as? Outcome.Ok)?.answer?.takeIf { it.type == ANSWER_CHOICES }?.choices.orEmpty()

    private var localSeq = 0

    /**
     * A line in the conversation only this device knows: from the app, seen
     * only by this person, gone when dismissed or when the conversation is
     * loaded again.
     */
    @Synchronized
    fun localNotice(channelId: String, appId: String, text: String) {
        localSeq = (localSeq + 1) % 4096
        val now = System.currentTimeMillis()
        val id = (((now - Ids.EPOCH_MS) shl 22) + localSeq).toString()
        val hook = buildJsonObject {
            put("name", appName(appId))
            put("content", text)
            put("application_id", appId)
        }
        val m = Message(id = id, channelId = channelId, authorId = appId, flags = Message.MSG_FLAG_EPHEMERAL, createdAt = now, webhook = hook)
        Nexa.messages.insert(channelId, listOf(ChatMessage(m, payload = MessagePayload(t = text), hook = hook, local = true)))
    }

    /** Puts away a message only this person sees: on the server too, unless only this device knew it. */
    fun dismiss(cm: ChatMessage) {
        Nexa.messages.removeMany(cm.channelId, listOf(cm.id))
        if (!cm.local) Nexa.scope.launch { runCatching { Apps.dismiss(cm.id) } }
    }

    /**
     * A message as an app may be shown it for a command used on it: nothing
     * when the app reads it already (it came readable, or the app reads every
     * message it can see); otherwise its content sealed to the app's bot, base64.
     */
    fun copyFor(appId: String, cm: ChatMessage): String? {
        if (cm.hook != null) return null
        val payload = cm.payload ?: return null
        // the channel's command list carries each app's bot with its key; the people
        // kept here may not have the bot at all (an app on someone's own account)
        val listed = AppCommands.of(cm.channelId)?.applications?.firstOrNull { it.id == appId }?.bot
        val bot = listed?.takeIf { it.publicKey.isNotEmpty() } ?: Nexa.users.get(appId) ?: return null
        if (bot.publicKey.isEmpty() || bot.readsAll) return null
        return runCatching { Bytes.b64(Keys.seal(Bytes.unb64(bot.publicKey), Bytes.utf8(payload.toJson().toString()))) }.getOrNull()
    }
}
