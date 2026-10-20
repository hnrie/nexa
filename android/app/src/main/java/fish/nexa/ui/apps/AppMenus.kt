package fish.nexa.ui.apps

import fish.nexa.Nexa
import fish.nexa.data.AppCommands
import fish.nexa.data.ChatMessage
import fish.nexa.data.Interactions
import fish.nexa.data.P
import fish.nexa.net.InteractRequest
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.t
import fish.nexa.ui.shell.confirm
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * The Apps item of a message's and a person's menu (web
 * components/chat/apps/appMenus.ts): the commands apps made for a message (a
 * message command) or a person (a user command), in a submenu, under each
 * app's name. Chosen, the app is told what it was used on; a message it could
 * not read otherwise goes to it sealed to its bot, so the app reads only the
 * message it was asked about.
 */

/** Where apps' commands may be used: anywhere outside a server, and in a server with Use Application Commands. */
private fun mayUse(channelId: String): Boolean {
    val ch = Nexa.channels.get(channelId) ?: return false
    if (ch.serverId == null) return true
    return Nexa.servers.canI(Nexa.servers.get(ch.serverId), P.USE_APPLICATION_COMMANDS, channelId)
}

private fun appsItem(channelId: String, type: Int, use: (appId: String, commandId: String) -> Unit): MenuItem.Submenu? {
    if (!mayUse(channelId)) return null
    val list = AppCommands.of(channelId)
    // not known yet, or stale: asked for now, for the next time the menu opens
    Nexa.scope.launch { AppCommands.load(channelId) }
    if (list == null) return null
    val entries = AppCommands.ofType(list, type)
    if (entries.isEmpty()) return null
    val several = entries.map { it.app.id }.toSet().size > 1
    val items = ArrayList<MenuItem>()
    var lastApp = ""
    for ((app, command) in entries) {
        if (several && app.id != lastApp) items += MenuItem.Heading(app.name)
        lastApp = app.id
        items += MenuItem.Action(AppCommands.name(command)) { use(app.id, command.id) }
    }
    return MenuItem.Submenu(t("apps.menu.apps"), items)
}

/** The Apps item of a message's menu. */
fun messageAppsItem(cm: ChatMessage): MenuItem.Submenu? {
    if (cm.local || cm.m.ephemeral || cm.m.type.startsWith("system_")) return null
    return appsItem(cm.channelId, AppCommands.CMD_MESSAGE) { appId, commandId ->
        val go: suspend () -> Unit = {
            val copy = Interactions.copyFor(appId, cm)
            Interactions.interact(InteractRequest(2, appId, cm.channelId, data = buildJsonObject {
                put("id", commandId)
                put("target_id", cm.id)
            }, copy = copy))
        }
        // an app on the person's own account is not part of this conversation:
        // they say so before it is handed someone's message (in a conversation
        // with the app's own bot, the messages are already its)
        val list = AppCommands.of(cm.channelId)
        val app = list?.applications?.firstOrNull { it.id == appId }
        if (app == null || "guild" in app.installed || list.context == 1) {
            Nexa.scope.launch { go() }
        } else {
            confirm(t("apps.shareMessage.title", "app" to app.name), t("apps.shareMessage.body", "app" to app.name), t("apps.shareMessage.continue"), danger = false) { go() }
        }
    }
}

/** The Apps item of a person's menu, used in a conversation. */
fun userAppsItem(channelId: String?, userId: String): MenuItem.Submenu? {
    if (channelId == null) return null
    return appsItem(channelId, AppCommands.CMD_USER) { appId, commandId ->
        Nexa.scope.launch {
            Interactions.interact(InteractRequest(2, appId, channelId, data = buildJsonObject {
                put("id", commandId)
                put("target_id", userId)
            }))
        }
    }
}

/**
 * Puts a person's Apps item into their menu where the web has it: after
 * everything else that acts on them, before the copy of their ID that
 * Developer Mode adds.
 */
fun withApps(items: ArrayList<MenuItem>, apps: MenuItem.Submenu?) {
    if (apps == null || items.isEmpty()) return
    val at = if (Nexa.settings.developerMode && items.size > 1) items.lastIndex else items.size
    // the line between groups: before the Apps item, and after it when the ID follows
    val before = items[at - 1]
    if (before is MenuItem.Action) items[at - 1] = before.copy(separatorAfter = true)
    items.add(at, apps.copy(separatorAfter = at < items.size))
}
