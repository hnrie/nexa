package fish.nexa.ui.nav

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import fish.nexa.Nexa

/** Where the person is, as the web's addresses name it. */
sealed interface Route {
    /** `/channels/@me`: Friends. */
    data object Friends : Route
    /** `/channels/@me/<id>`: a DM, group or subchat. */
    data class Dm(val channelId: String, val jumpTo: String? = null) : Route
    /** `/channels/@me/nexa`: the official Nexa conversation. */
    data object NexaConvo : Route
    /** `/channels/@me/notes[/<id>]`. */
    data class Notes(val noteId: String? = null) : Route
    /** `/channels/<server>/<channel>`. */
    data class Server(val serverId: String, val channelId: String? = null, val jumpTo: String? = null) : Route
    /** `/channels/@admin`: staff only. */
    data object Admin : Route

    val isHome get() = this is Friends || this is Dm || this is NexaConvo || this is Notes
}

/**
 * Navigation on a phone (web AppShell + backLayers): one page at a time, a
 * history to go back through, the navigation drawer on the start side and the
 * member drawer on the end side, and the rules for which taps keep the drawer
 * open (picking a server) and which close it (picking a channel).
 */
object Nav {
    var route by mutableStateOf<Route>(Route.Friends)
        private set
    var leftOpen by mutableStateOf(false)
    var rightOpen by mutableStateOf(false)
    private val history = ArrayDeque<Route>()

    val canGoBack get() = history.isNotEmpty()

    fun go(next: Route, keepDrawer: Boolean = false, replace: Boolean = false) {
        val target = resolve(next)
        if (target != route) {
            if (!replace) {
                history.addLast(route)
                while (history.size > 50) history.removeFirst()
            }
            route = target
        }
        rightOpen = false
        if (!keepDrawer) leftOpen = false
        publish()
    }

    /** History back; false when there is nothing to go back to. */
    fun back(): Boolean {
        val prev = history.removeLastOrNull() ?: return false
        route = prev
        rightOpen = false
        publish()
        return true
    }

    /** A server opens on its remembered text channel, else its first one (serverNav.ts). */
    private fun resolve(r: Route): Route {
        if (r is Route.Server && r.channelId == null) {
            val remembered = lastChannel(r.serverId)?.takeIf { id -> Nexa.channels.get(id)?.let { it.serverId == r.serverId && it.isText } == true }
            return r.copy(channelId = remembered ?: firstTextChannel(r.serverId))
        }
        return r
    }

    fun firstTextChannel(serverId: String): String? {
        val all = Nexa.channels.byId.value.values.filter { it.serverId == serverId }
        val cats = all.filter { it.isCategory }.sortedWith(compareBy({ it.position }, { it.id.length }, { it.id })).map { it.id }.toSet()
        val loose = all.filter { it.isText && (it.parentId == null || it.parentId !in cats) }.sortedWith(compareBy({ it.position }, { it.id.length }, { it.id }))
        loose.firstOrNull()?.let { return it.id }
        for (cat in all.filter { it.isCategory }.sortedWith(compareBy({ it.position }, { it.id.length }, { it.id }))) {
            all.filter { it.isText && it.parentId == cat.id }.minWithOrNull(compareBy({ it.position }, { it.id.length }, { it.id }))?.let { return it.id }
        }
        return null
    }

    private fun prefs() = Nexa.app.getSharedPreferences("nav", Context.MODE_PRIVATE)

    fun lastChannel(serverId: String): String? = Nexa.users.meId?.let { prefs().getString("lastChannel:$it:$serverId", null) }

    fun rememberChannel(serverId: String, channelId: String) {
        val me = Nexa.users.meId ?: return
        prefs().edit().putString("lastChannel:$me:$serverId", channelId).apply()
    }

    private fun publish() {
        when (val r = route) {
            is Route.Server -> {
                Nexa.ui.open(r.serverId, r.channelId)
                if (r.channelId != null && Nexa.channels.get(r.channelId)?.isText == true) rememberChannel(r.serverId, r.channelId)
            }
            is Route.Dm -> Nexa.ui.open(null, r.channelId)
            else -> Nexa.ui.open(null, null)
        }
    }

    fun reset() {
        history.clear()
        route = Route.Friends
        leftOpen = false
        rightOpen = false
        publish()
    }
}
