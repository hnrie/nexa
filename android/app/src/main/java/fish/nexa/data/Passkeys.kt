package fish.nexa.data

import android.app.Activity
import android.os.Build
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Identity
import fish.nexa.crypto.Keys
import fish.nexa.net.MeUser
import fish.nexa.net.wireJson
import fish.nexa.ui.ReadableError
import fish.nexa.ui.t
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Passkeys (web/src/lib/passkeys.ts): signing in and opening the account's
 * keys in one step, through Android's Credential Manager. Every passkey Nexa
 * keeps gives a PRF output for the same fixed input; a key made from it wraps
 * the identity key, and the server keeps that wrapped copy.
 *
 * Only Android 14 and newer offer passkeys to apps without Google Play
 * services, which the app does not use, so older phones are not offered them.
 */
object Passkeys {
    private val PRF_INPUT = Bytes.utf8("nexa passkey prf v1")
    private val WRAP_INFO = Bytes.utf8("nexa passkey identity v1")

    @Serializable
    data class Info(
        val id: String,
        val name: String = "",
        @SerialName("rp_id") val rpId: String = "",
        @SerialName("created_at") val createdAt: Long = 0,
        @SerialName("last_used_at") val lastUsedAt: Long = 0,
    )

    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE

    fun wrapKey(prf: ByteArray): ByteArray = Bytes.hkdf(prf, ByteArray(0), WRAP_INFO, 32)

    /** True when the person closed the system's passkey sheet: nothing to say about it. */
    fun cancelled(e: Throwable) = e is GetCredentialCancellationException || e is CreateCredentialCancellationException

    private fun prfExt() = buildJsonObject { put("prf", buildJsonObject { put("eval", buildJsonObject { put("first", Bytes.b64url(PRF_INPUT)) }) }) }

    private fun prfOf(response: JsonObject): ByteArray? =
        (response["clientExtensionResults"] as? JsonObject)?.get("prf")?.let { it as? JsonObject }
            ?.get("results")?.let { it as? JsonObject }?.get("first")?.jsonPrimitive?.contentOrNull
            ?.let { try { Bytes.unb64url(it) } catch (_: Exception) { null } }

    private fun std(b64url: String) = Bytes.b64(Bytes.unb64url(b64url))

    /** Adds a passkey to the signed-in account: the password first, then the system's sheet. */
    suspend fun add(activity: Activity, password: String, identity: Identity, name: String): Info {
        val authKey = Nexa.auth.currentAuthKey(password)
        val opts = Nexa.api.request("POST", "/auth/passkeys/options", buildJsonObject { put("auth_key", Bytes.b64(authKey)) }) as JsonObject
        val pk = opts["public_key"]!!.jsonObject
        val request = JsonObject(pk + ("extensions" to prfExt()))
        val cm = CredentialManager.create(activity)
        val res = cm.createCredential(activity, CreatePublicKeyCredentialRequest(request.toString())) as CreatePublicKeyCredentialResponse
        val json = wireJson.parseToJsonElement(res.registrationResponseJson).jsonObject
        val rawId = json["rawId"]?.jsonPrimitive?.contentOrNull ?: json["id"]!!.jsonPrimitive.content
        val rp = pk["rp"]!!.jsonObject["id"]!!.jsonPrimitive.content
        val prf = prfOf(json) ?: prfFromUse(activity, rp, rawId)
        val response = json["response"]!!.jsonObject
        val out = Nexa.api.request("POST", "/auth/passkeys", buildJsonObject {
            put("ticket", opts["ticket"]!!.jsonPrimitive.content)
            put("name", name)
            put("client_data_json", std(response["clientDataJSON"]!!.jsonPrimitive.content))
            put("attestation_object", std(response["attestationObject"]!!.jsonPrimitive.content))
            put("enc_private_key", Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, wrapKey(prf))))
        })
        return wireJson.decodeFromJsonElement(Info.serializer(), out)
    }

    /** For the providers that give the PRF output only when a passkey is used, not when it is made. */
    private suspend fun prfFromUse(activity: Activity, rp: String, credentialId: String): ByteArray {
        val req = buildJsonObject {
            put("challenge", Bytes.b64url(Bytes.random(32)))
            put("rpId", rp)
            put("allowCredentials", JsonArray(listOf(buildJsonObject { put("type", "public-key"); put("id", credentialId) })))
            put("userVerification", "required")
            put("extensions", prfExt())
        }
        val cred = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(req.toString())))).credential
        val json = (cred as? PublicKeyCredential)?.authenticationResponseJson?.let { wireJson.parseToJsonElement(it).jsonObject }
        return json?.let { prfOf(it) } ?: throw ReadableError(t("passkeys.noPrf"))
    }

    /** Signs in with a passkey: the session, and the identity key the passkey opens. */
    suspend fun signIn(activity: Activity): Triple<MeUser, String, Identity> {
        val begin = Nexa.api.request("POST", "/auth/passkey/begin", JsonObject(emptyMap()), auth = false) as JsonObject
        val req = JsonObject(begin["public_key"]!!.jsonObject + ("extensions" to prfExt()))
        val cred = try {
            CredentialManager.create(activity).getCredential(activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(req.toString())))).credential
        } catch (_: NoCredentialException) {
            throw ReadableError(t("android.passkeys.noneOnThisPhone"))
        }
        val json = wireJson.parseToJsonElement((cred as PublicKeyCredential).authenticationResponseJson).jsonObject
        val response = json["response"]!!.jsonObject
        val rawId = json["rawId"]?.jsonPrimitive?.contentOrNull ?: json["id"]!!.jsonPrimitive.content
        val out = Nexa.api.request("POST", "/auth/passkey/finish", buildJsonObject {
            put("ticket", begin["ticket"]!!.jsonPrimitive.content)
            put("credential_id", std(rawId))
            put("client_data_json", std(response["clientDataJSON"]!!.jsonPrimitive.content))
            put("authenticator_data", std(response["authenticatorData"]!!.jsonPrimitive.content))
            put("signature", std(response["signature"]!!.jsonPrimitive.content))
        }, auth = false) as JsonObject
        val token = out["token"]!!.jsonPrimitive.content
        // a session was made: without the key it would open on a locked screen, so it goes again
        suspend fun giveUp(key: String): Nothing {
            try {
                Nexa.api.request("POST", "/auth/logout", headers = mapOf("Authorization" to "Bearer $token"), auth = false)
            } catch (_: Exception) {
            }
            throw ReadableError(t(key))
        }
        val prf = prfOf(json) ?: giveUp("passkeys.noPrf")
        val pub = out["public_key"]!!.jsonPrimitive.content
        val priv = try {
            Keys.unwrapPrivateKey(Bytes.unb64(out["enc_private_key"]!!.jsonPrimitive.content), wrapKey(prf))
        } catch (_: Exception) {
            giveUp("passkeys.couldNotOpenKeys")
        }
        if (Bytes.b64(Identity.publicKeyOf(priv)) != pub) giveUp("passkeys.couldNotOpenKeys")
        val me = wireJson.decodeFromJsonElement(MeUser.serializer(), out["user"]!!)
        return Triple(me, token, Identity(Bytes.unb64(pub), priv))
    }

    suspend fun list(): List<Info> = wireJson.decodeFromJsonElement(ListSerializer(Info.serializer()), Nexa.api.get("/auth/passkeys"))
    suspend fun rename(id: String, name: String) { Nexa.api.request("PATCH", "/auth/passkeys/$id", buildJsonObject { put("name", name) }) }
    suspend fun remove(id: String) { Nexa.api.request("DELETE", "/auth/passkeys/$id") }

}
