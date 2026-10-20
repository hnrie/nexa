package fish.nexa.data

import fish.nexa.net.AppCommand
import fish.nexa.net.ChannelCommands
import fish.nexa.net.CommandApp
import fish.nexa.net.CommandChoice
import fish.nexa.net.CommandOption
import fish.nexa.ui.I18n
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * What apps offer in each channel (web stores/appCommands.ts): their slash
 * commands and the entries of people's and messages' menus, as
 * GET /channels/{id}/commands answers. Kept for a few minutes per channel and
 * loaded when a channel opens. When the server says an app's commands changed
 * or an app was added or taken away, every kept list goes stale: it stays in
 * use until it is read again, and the channel asked for last is read again at
 * once, so its menus and its message box never go without one.
 */
object AppCommands {
    /** How long a channel's list is trusted before it is asked for again. */
    private const val FRESH_MS = 5 * 60 * 1000L

    data class Entry(val at: Long, val data: ChannelCommands?)

    /** A command to start in a channel's message box: one tapped where someone else used it. `name` has its subcommands ("config set"). */
    data class Start(val channelId: String, val applicationId: String, val name: String)

    private val _byChannel = MutableStateFlow<Map<String, Entry>>(emptyMap())
    val byChannel: StateFlow<Map<String, Entry>> = _byChannel

    private val _start = MutableStateFlow<Start?>(null)

    /** A command waiting for the message box of its channel to pick it up. */
    val start: StateFlow<Start?> = _start

    fun startCommand(s: Start?) {
        _start.value = s
    }

    private val inFlight = HashMap<String, CompletableDeferred<ChannelCommands?>>()

    /** The channel whose list was asked for last: the one open now. */
    @Volatile private var lastChannel: String? = null

    /** A channel's kept list, as it is now, stale or not (null until it has first loaded). */
    fun of(channelId: String): ChannelCommands? = _byChannel.value[channelId]?.data

    /** Loads a channel's list unless a fresh one is kept; null when it could not load. */
    suspend fun load(channelId: String, force: Boolean = false): ChannelCommands? {
        lastChannel = channelId
        val kept = _byChannel.value[channelId]
        if (!force && kept?.data != null && System.currentTimeMillis() - kept.at < FRESH_MS) return kept.data
        val (going, mine) = synchronized(inFlight) {
            inFlight[channelId]?.let { it to false } ?: CompletableDeferred<ChannelCommands?>().also { inFlight[channelId] = it }.let { it to true }
        }
        if (!mine) return going.await()
        val data = runCatching { Apps.inChannel(channelId) }.getOrNull()
        if (data != null) _byChannel.update { it + (channelId to Entry(System.currentTimeMillis(), data)) }
        synchronized(inFlight) { inFlight.remove(channelId) }
        val out = data ?: kept?.data
        going.complete(out)
        return out
    }

    /** Marks every kept list stale, so each is loaded again when it is next needed, and reloads the channel asked for last. */
    fun forget() {
        synchronized(inFlight) { inFlight.clear() }
        _byChannel.update { all -> all.mapValues { (_, e) -> e.copy(at = 0) } }
        lastChannel?.let { id -> fish.nexa.Nexa.scope.launch { load(id, force = true) } }
    }

    // command types
    const val CMD_SLASH = 1
    const val CMD_USER = 2
    const val CMD_MESSAGE = 3

    // option types, at the protocol's numbers
    const val OPT_SUBCOMMAND = 1
    const val OPT_GROUP = 2
    const val OPT_STRING = 3
    const val OPT_INTEGER = 4
    const val OPT_BOOLEAN = 5
    const val OPT_USER = 6
    const val OPT_CHANNEL = 7
    const val OPT_ROLE = 8
    const val OPT_MENTIONABLE = 9
    const val OPT_NUMBER = 10
    const val OPT_ATTACHMENT = 11

    data class Offered(val app: CommandApp, val command: AppCommand)

    /** The commands of one type a channel offers, each with its app, apps in the order the server listed them. */
    fun ofType(list: ChannelCommands?, type: Int): List<Offered> {
        if (list == null) return emptyList()
        val apps = list.applications.associateBy { it.id }
        val order = list.applications.withIndex().associate { (i, a) -> a.id to i }
        val collator = java.text.Collator.getInstance(I18n.locale)
        return list.commands.filter { it.type == type }.mapNotNull { c -> apps[c.applicationId]?.let { Offered(it, c) } }
            .sortedWith(compareBy<Offered> { order[it.app.id] ?: 0 }.thenBy(collator) { it.command.name })
    }

    /**
     * The language someone uses, as bot libraries name languages (an app picks
     * its replies by it). Nexa's own tags, with the regional ones those
     * libraries use where they differ; Arabic has none there and goes as it is.
     */
    fun protocolLocale(tag: String = I18n.tag): String = when (tag) {
        "en" -> "en-US"
        "es" -> "es-ES"
        "sv" -> "sv-SE"
        else -> tag
    }

    /** A name or description in the reader's language, where the app gave one. */
    fun localized(base: String, map: Map<String, String>?, language: String? = null): String {
        if (map == null) return base
        val tag = language ?: I18n.tag
        return map[protocolLocale(tag)] ?: map[tag] ?: (if (tag == "en") map["en-GB"] else if (tag == "es") map["es-419"] else null) ?: base
    }

    fun name(c: AppCommand) = localized(c.name, c.nameLocalizations)
    fun description(c: AppCommand) = localized(c.description, c.descriptionLocalizations)
    fun name(o: CommandOption) = localized(o.name, o.nameLocalizations)
    fun description(o: CommandOption) = localized(o.description, o.descriptionLocalizations)
    fun name(c: CommandChoice) = localized(c.name, c.nameLocalizations)

    /**
     * One command a slash command really is: itself, or one of its
     * subcommands, or of its groups' subcommands, by its full name
     * ("config set"), with the options that one takes. `path` is the
     * subcommand path under the command ([] for the command itself).
     */
    data class Leaf(val command: AppCommand, val path: List<String>, val label: String, val description: String, val options: List<CommandOption>)

    fun leaves(command: AppCommand): List<Leaf> {
        val top = name(command)
        val subs = command.options.orEmpty().filter { it.type == OPT_SUBCOMMAND || it.type == OPT_GROUP }
        if (subs.isEmpty()) return listOf(Leaf(command, emptyList(), top, description(command), command.options.orEmpty()))
        val out = ArrayList<Leaf>()
        for (o in subs) {
            if (o.type == OPT_SUBCOMMAND) {
                out += Leaf(command, listOf(o.name), "$top ${name(o)}", description(o), o.options.orEmpty())
                continue
            }
            for (sub in o.options.orEmpty()) {
                if (sub.type != OPT_SUBCOMMAND) continue
                out += Leaf(command, listOf(o.name, sub.name), "$top ${name(o)} ${name(sub)}", description(sub), sub.options.orEmpty())
            }
        }
        return out
    }

    /** One option's value as the server takes it. */
    data class Given(val name: String, val value: JsonElement, val focused: Boolean = false)

    /** Options as the server takes them, nested under the subcommand path. */
    fun nest(path: List<String>, options: List<Given>): JsonArray {
        var list = JsonArray(options.map { o ->
            JsonObject(buildMap {
                put("name", JsonPrimitive(o.name))
                put("value", o.value)
                if (o.focused) put("focused", JsonPrimitive(true))
            })
        })
        for (i in path.indices.reversed()) list = JsonArray(listOf(JsonObject(mapOf("name" to JsonPrimitive(path[i]), "options" to list))))
        return list
    }
}
