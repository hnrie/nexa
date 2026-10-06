package fish.nexa.ui.voice

import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.net.ApiError
import fish.nexa.net.Channel
import fish.nexa.net.VoiceState
import fish.nexa.ui.chat.outranks
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.shell.ChannelTree
import fish.nexa.ui.t
import fish.nexa.voice.Voice
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * voiceModeration.ts: what a moderator can do to someone in one of a
 * server's voice channels. Server Mute, Server Deafen, Move To and Disconnect
 * sit on the person's row under the channel and on their tile in the call,
 * each where this account may, by the server's own checks
 * (handleVoiceModerate): the permission in the channel they are in, a role
 * above theirs (a guest holds none), and for a move a channel this account can
 * see and they may connect to. A mute and a deafen stay on the member until a
 * moderator lifts them. On a phone, Move To stands in for dragging.
 */
object VoiceModeration {
    data class Powers(val mute: Boolean, val deafen: Boolean, val move: Boolean)

    private val NONE = Powers(mute = false, deafen = false, move = false)

    fun inAsGuest(vs: VoiceState): Boolean = Voice.isGuest(vs) || isGuestUser(vs.userId)

    /** What this account may do to someone in a voice channel of a server; nothing to itself. */
    fun powers(serverId: String, channelId: String, vs: VoiceState): Powers {
        val st = Nexa.servers.get(serverId) ?: return NONE
        if (vs.userId == Nexa.users.meId) return NONE
        if (!inAsGuest(vs) && !outranks(serverId, vs.userId)) return NONE
        fun may(perm: Long) = Nexa.servers.canI(st, P.VIEW_CHANNEL or perm, channelId)
        return Powers(may(P.MUTE_MEMBERS), may(P.DEAFEN_MEMBERS), may(P.MOVE_MEMBERS))
    }

    /** The voice channels someone could be moved to, in the sidebar's order: ones this account can see and they may connect to. */
    fun moveTargets(serverId: String, userId: String, fromId: String): List<Channel> {
        val st = Nexa.servers.get(serverId) ?: return emptyList()
        val tree = ChannelTree.of(serverId, Nexa.channels.byId.value.values)
        return (tree.loose + tree.categories.flatMap { it.children }).filter { ch ->
            ch.type == "voice" && ch.id != fromId && Nexa.servers.canI(st, P.VIEW_CHANNEL, ch.id) && P.has(Nexa.servers.channelPerms(st, ch.id, userId), P.CONNECT)
        }
    }

    /** A server mute a moderator gave, as opposed to a channel that lets nobody speak. */
    fun modMuted(vs: VoiceState): Boolean = vs.serverMute && !vs.suppress

    private fun moderate(serverId: String, userId: String, body: kotlinx.serialization.json.JsonObject) {
        Nexa.scope.launch {
            try {
                Nexa.api.request("PATCH", "/servers/$serverId/members/$userId/voice", body)
            } catch (e: ApiError) {
                Nexa.ui.toast(e.message ?: t("voice.moderation.failed"), "error")
            } catch (e: Exception) {
                Nexa.ui.toast(t("voice.moderation.failed"), "error")
            }
        }
    }

    fun setMute(serverId: String, userId: String, on: Boolean) = moderate(serverId, userId, buildJsonObject { put("mute", on) })
    fun setDeafen(serverId: String, userId: String, on: Boolean) = moderate(serverId, userId, buildJsonObject { put("deaf", on) })
    fun move(serverId: String, userId: String, channelId: String) = moderate(serverId, userId, buildJsonObject { put("channel_id", channelId) })
    fun disconnect(serverId: String, userId: String) = moderate(serverId, userId, buildJsonObject { put("channel_id", JsonNull) })

    /**
     * The moderator's part of someone's menu in a voice channel: Server Mute,
     * Server Deafen, Move To and Disconnect, each where this account may. A
     * guest is put out with the call's own Remove From Call.
     */
    fun items(serverId: String, channelId: String, vs: VoiceState): List<MenuItem> {
        val can = powers(serverId, channelId, vs)
        val out = ArrayList<MenuItem>()
        val muted = modMuted(vs)
        if (can.mute) out += MenuItem.Action(t("voice.moderation.serverMute"), checked = muted, toggle = true) { setMute(serverId, vs.userId, !muted) }
        if (can.deafen) out += MenuItem.Action(t("voice.moderation.serverDeafen"), checked = vs.serverDeaf, toggle = true) { setDeafen(serverId, vs.userId, !vs.serverDeaf) }
        if (can.move && !inAsGuest(vs)) {
            out += MenuItem.Submenu(t("voice.moderation.moveTo"), moveTargets(serverId, vs.userId, channelId).map { ch -> MenuItem.Action(ch.name) { move(serverId, vs.userId, ch.id) } })
            out += MenuItem.Action(t("voice.moderation.disconnect"), danger = true) { disconnect(serverId, vs.userId) }
        }
        return out
    }
}
