package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.AppCommand
import fish.nexa.net.AppSummary
import fish.nexa.net.AuthorizeInfo
import fish.nexa.net.AuthorizedApp
import fish.nexa.net.ChannelCommands
import fish.nexa.net.CommandPermission
import fish.nexa.net.IntegrationCommands
import fish.nexa.net.InteractRequest
import fish.nexa.net.InteractionAnswer
import fish.nexa.net.InteractionFile
import fish.nexa.net.OwnedApp
import fish.nexa.net.PublicUser
import fish.nexa.net.ServerApp
import fish.nexa.net.wireJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Apps (web api/apps.ts): programs with a bot account, made in Settings,
 * Developer Portal, and added to servers and accounts. Bot libraries talk to
 * the server through the bot API; this is the app's side of it: making and
 * changing apps, adding them, managing them in a server, and using what they
 * made (commands, buttons, select menus and forms).
 */
object Apps {
    private suspend fun call(method: String, path: String, body: JsonElement? = null): JsonElement = Nexa.api.request(method, path, body)
    private fun authKey(key: String) = buildJsonObject { put("auth_key", key) }

    // the Developer Portal
    suspend fun mine(): List<OwnedApp> = wireJson.decodeFromJsonElement(ListSerializer(OwnedApp.serializer()), call("GET", "/applications"))

    /** Makes an app; its bot's token comes back this once. */
    suspend fun create(name: String): Pair<OwnedApp, String> {
        val o = call("POST", "/applications", buildJsonObject { put("name", name) }) as JsonObject
        return wireJson.decodeFromJsonElement(OwnedApp.serializer(), o["application"]!!) to ((o["token"] as? JsonPrimitive)?.contentOrNull ?: "")
    }

    suspend fun get(id: String): OwnedApp = wireJson.decodeFromJsonElement(OwnedApp.serializer(), call("GET", "/applications/$id"))

    /** Changes an app: `patch` in the server's shape (api/apps.ts AppPatch). */
    suspend fun update(id: String, patch: JsonObject): OwnedApp = wireJson.decodeFromJsonElement(OwnedApp.serializer(), call("PATCH", "/applications/$id", patch))

    suspend fun updateBot(id: String, patch: JsonObject): PublicUser = wireJson.decodeFromJsonElement(PublicUser.serializer(), call("PATCH", "/applications/$id/bot", patch))

    suspend fun resetToken(id: String, key: String): String = fish.nexa.net.Api.str(call("POST", "/applications/$id/bot/reset", authKey(key)), "token") ?: ""

    suspend fun resetSecret(id: String, key: String): String = fish.nexa.net.Api.str(call("POST", "/applications/$id/secret/reset", authKey(key)), "secret") ?: ""

    suspend fun remove(id: String, key: String) {
        call("POST", "/applications/$id/delete", authKey(key))
    }

    /** An app's commands everywhere, and those made for single servers, for its owner. */
    suspend fun commands(id: String): List<AppCommand> = wireJson.decodeFromJsonElement(ListSerializer(AppCommand.serializer()), call("GET", "/applications/$id/commands"))

    /** Takes one of an app's commands away, for its owner. */
    suspend fun deleteCommand(id: String, commandId: String) {
        call("DELETE", "/applications/$id/commands/$commandId")
    }

    /** Takes every command an app made away, single servers' included, for its owner. */
    suspend fun deleteAllCommands(id: String) {
        call("DELETE", "/applications/$id/commands")
    }

    /** What anyone is shown of an app. */
    suspend fun about(id: String): AppSummary = wireJson.decodeFromJsonElement(AppSummary.serializer(), call("GET", "/applications/$id/public"))

    // using what apps made
    suspend fun inChannel(channelId: String): ChannelCommands = wireJson.decodeFromJsonElement(ChannelCommands.serializer(), call("GET", "/channels/$channelId/commands"))

    suspend fun interact(req: InteractRequest): InteractionAnswer =
        wireJson.decodeFromJsonElement(InteractionAnswer.serializer(), call("POST", "/interactions", wireJson.encodeToJsonElement(InteractRequest.serializer(), req)))

    /** Sends a file for a command's file option or a form's file field; the server keeps it for the app. */
    suspend fun sendFile(name: String, type: String, bytes: ByteArray): InteractionFile = withContext(Dispatchers.IO) {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", name, bytes.toRequestBody(type.toMediaTypeOrNull()))
            .build()
        val req = Nexa.api.requestBuilder("/interactions/files").post(body).build()
        wireJson.decodeFromJsonElement(InteractionFile.serializer(), Nexa.api.execute(Nexa.api.transfer, req, true))
    }

    suspend fun dismiss(messageId: String) {
        call("DELETE", "/ephemeral/$messageId")
    }

    // adding apps, and the ones let in
    suspend fun authorizeInfo(query: String): AuthorizeInfo = wireJson.decodeFromJsonElement(AuthorizeInfo.serializer(), call("GET", "/oauth2/authorize?$query"))

    /** Adds an app as the link asks; the answer may say where to go next (`location`) and which server it went to. */
    suspend fun authorize(query: String, guildId: String?, permissions: String?): JsonObject =
        call("POST", "/oauth2/authorize", buildJsonObject {
            put("query", query)
            guildId?.let { put("guild_id", it) }
            permissions?.let { put("permissions", it) }
        }) as? JsonObject ?: JsonObject(emptyMap())

    suspend fun authorized(): List<AuthorizedApp> = wireJson.decodeFromJsonElement(ListSerializer(AuthorizedApp.serializer()), call("GET", "/oauth2/authorized"))

    suspend fun deauthorize(appId: String) {
        call("DELETE", "/oauth2/authorized/$appId")
    }

    // a server's apps, for its managers
    suspend fun inServer(serverId: String): List<ServerApp> = wireJson.decodeFromJsonElement(ListSerializer(ServerApp.serializer()), call("GET", "/servers/$serverId/integrations"))

    suspend fun removeFromServer(serverId: String, appId: String) {
        call("DELETE", "/servers/$serverId/integrations/$appId")
    }

    suspend fun serverCommands(serverId: String, appId: String): IntegrationCommands =
        wireJson.decodeFromJsonElement(IntegrationCommands.serializer(), call("GET", "/servers/$serverId/integrations/$appId/commands"))

    suspend fun setCommandPermissions(serverId: String, appId: String, commandId: String, permissions: List<CommandPermission>) {
        call("PUT", "/servers/$serverId/integrations/$appId/commands/$commandId/permissions", buildJsonObject {
            put("permissions", wireJson.encodeToJsonElement(ListSerializer(CommandPermission.serializer()), permissions))
        })
    }
}
