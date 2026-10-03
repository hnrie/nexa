package fish.nexa.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.People
import fish.nexa.net.PublicUser
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxCheckbox
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.launch

/** Account flags (lib/moderation.ts). */
object AccountFlags {
    const val ADMIN = 1L
    const val DISABLED = 2L
    const val DELETED = 4L
    const val SYSTEM = 16L
    const val WEBHOOK = 32L

    fun isSystem(flags: Long) = flags and SYSTEM != 0L
}

/** lib/owner.ts: who owns Nexa (crowned wherever they are listed). */
object NexaOwner {
    private const val FALLBACK = "92209128029552640"

    fun id(): String {
        val named = ((Nexa.users.me.value?.nexa as? kotlinx.serialization.json.JsonObject)?.get("owner_id") as? kotlinx.serialization.json.JsonPrimitive)?.content
        return if (named.isNullOrEmpty() || named == "0") FALLBACK else named
    }

    fun isOwner(userId: String?) = userId != null && userId == id()
}

/** lib/profileLinks.ts: the shareable `/@username` link. */
object ProfileLinks {
    fun origin(): String = Nexa.auth.instance.value?.publicUrl?.trimEnd('/')?.ifEmpty { null } ?: Nexa.api.baseUrl.trimEnd('/')

    fun url(username: String) = "${origin()}/@$username"

    fun copy(username: String) = copyWithToast(url(username), t("clipboard.profileLinkCopied"))

    /** "Copy Profile Link", when the person has a link to share (not system, webhook or deleted accounts). */
    fun item(userId: String): MenuItem.Action? {
        val me = Nexa.users.me.value
        val (username, flags) = if (me?.id == userId) me.username to me.flags else Nexa.users.get(userId)?.let { it.username to it.flags } ?: return null
        if (username.isEmpty() || flags and (AccountFlags.SYSTEM or AccountFlags.WEBHOOK or AccountFlags.DELETED) != 0L) return null
        return MenuItem.Action(t("profileLink.copy")) { copy(username) }
    }
}

/** Copies text, saying so in our words where the system does not (it does from Android 13). */
fun copyWithToast(text: String, toast: String) {
    val cm = Nexa.app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    cm.setPrimaryClip(android.content.ClipData.newPlainText("Nexa", text))
    if (android.os.Build.VERSION.SDK_INT < 33) Nexa.ui.toast(toast, "success")
}

/** Opens (or creates) the DM with someone and goes there. */
fun openDmWith(userId: String, then: (suspend (String) -> Unit)? = null) {
    Nexa.scope.launch {
        try {
            val ch = People.openDm(userId)
            Nav.go(Route.Dm(ch.id))
            then?.invoke(ch.id)
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("profile.profileCard.couldNotOpenAConversation")), "error")
        }
    }
}

/** Opens the DM with someone and joins its call. */
fun callWith(userId: String) = openDmWith(userId) { id ->
    try {
        fish.nexa.voice.Calls.join(id)
    } catch (e: Exception) {
        Nexa.ui.toast(t("friends.thatCallCouldNotBeStarted"), "error")
    }
}

fun confirmRemoveFriend(user: PublicUser) {
    val name = Names.display(user)
    confirm(t("profile.profileCard.removeFriend"), t("friends.removeNameFromYourFriends", "name" to name), t("profile.profileCard.removeFriend")) {
        People.removeFriend(user.id)
    }
}

private fun nameList(users: List<PublicUser>): String = Names.list(users.map { Names.display(it) })

fun confirmRemoveFriends(users: List<PublicUser>) {
    if (users.size == 1) return confirmRemoveFriend(users[0])
    confirm(t("pick.removeFriendsTitle", "count" to users.size), t("pick.removeFriendsBody", "names" to nameList(users)), t("pick.removeFriends", "count" to users.size)) {
        People.removeFriends(users)
    }
}

fun confirmBlockPeople(users: List<PublicUser>) {
    if (users.size == 1) return openBlockDialog(users[0].id)
    confirm(t("pick.blockTitle", "count" to users.size), t("pick.blockBody", "names" to nameList(users)), t("pick.block", "count" to users.size)) {
        People.blockMany(users)
    }
}

/** relationshipMenuItems: add, accept/ignore, cancel or remove, then block or unblock. */
fun relationshipMenuItems(userId: String): List<MenuItem.Action> {
    val me = Nexa.users.me.value ?: return emptyList()
    val user = Nexa.users.get(userId) ?: return emptyList()
    if (userId == me.id || AccountFlags.isSystem(user.flags)) return emptyList()
    val rel = Nexa.relationships.typeOf(userId)
    val busy = People.isBusy(userId)
    val items = ArrayList<MenuItem.Action>()
    when (rel) {
        null -> items += MenuItem.Action(t("profile.profileCard.addFriend"), disabled = busy) { Nexa.scope.launch { People.sendRequest(user) } }
        "incoming" -> {
            items += MenuItem.Action(t("profile.profileCard.acceptFriendRequest"), disabled = busy) { Nexa.scope.launch { People.accept(user) } }
            items += MenuItem.Action(t("people.menu.ignoreRequest"), disabled = busy) { Nexa.scope.launch { People.dropRequest(userId) } }
        }
        "outgoing" -> items += MenuItem.Action(t("people.menu.cancelRequest"), disabled = busy) { Nexa.scope.launch { People.dropRequest(userId) } }
        "friend" -> items += MenuItem.Action(t("profile.profileCard.removeFriend"), danger = true) { confirmRemoveFriend(user) }
    }
    if (rel == "blocked") items += MenuItem.Action(t("friends.unblock"), disabled = busy) { Nexa.scope.launch { People.unblock(userId) } }
    else items += MenuItem.Action(t("profile.profileCard.block"), danger = true) { openBlockDialog(userId) }
    return items
}

/**
 * BlockDialog: what blocking does, and the two choices about their messages
 * (which are the account's choices for everyone blocked).
 */
fun openBlockDialog(userId: String) {
    val user = Nexa.users.get(userId) ?: return
    lateinit var layer: Layer
    layer = Layer("block") { close -> BlockSheet(layer, user, close) }
    Layers.open(layer)
}

@Composable
private fun BlockSheet(layer: Layer, user: PublicUser, close: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var hide by remember { mutableStateOf(Nexa.settings.hideBlockedMessages) }
    var replies by remember { mutableStateOf(Nexa.settings.hideBlockedReplies) }
    var busy by remember { mutableStateOf(false) }
    Sheet(layer, title = t("people.block.title", "name" to Names.display(user)), maxWidth = 460.dp, footer = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(t("profile.profileCard.block"), {
                busy = true
                scope.launch {
                    try {
                        People.block(user, hide, replies)
                        close()
                    } catch (e: Exception) {
                        Nexa.ui.toast(t("people.block.couldNotBlock"), "error")
                    } finally {
                        busy = false
                    }
                }
            }, kind = ButtonKind.DANGER, loading = busy)
        }
    }) {
        Txt(t("people.block.body"), style = Nx.type.body, color = c.text)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(t("people.blockedPage.messagesHeading"), style = Nx.type.label, color = c.textSubtle, modifier = Modifier.semantics { heading() })
            NxCheckbox(hide, { hide = it; if (!it) replies = false }, t("people.block.hideMessages"))
            Txt(t("people.block.hideMessagesHint"), style = Nx.type.hint, color = c.textMuted, modifier = Modifier.padding(start = 30.dp))
            Column(Modifier.padding(start = 30.dp, top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                NxCheckbox(replies, { replies = it }, t("people.block.hideReplies"), enabled = hide)
                Txt(t("people.block.hideRepliesHint"), style = Nx.type.hint, color = c.textMuted, modifier = Modifier.padding(start = 30.dp))
            }
        }
        Txt(t("people.block.appliesToAll"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(400)), color = c.textMuted)
    }
}
