package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.MeUser
import fish.nexa.net.wireJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/**
 * The accounts this phone is signed in to, for switching between them from
 * the status sheet (web/src/lib/accounts.ts). Only one runs at a time, the
 * one whose token is "token"; the others keep their tokens here and their
 * keys where they always were (identity-<id>, roots-<id>, the passcode lock),
 * so switching is putting another token in and opening the app again.
 */
object Accounts {
    /** As many as the sheet shows without growing past the screen, as on the web. */
    const val MAX = 5

    @Serializable
    data class Saved(
        val id: String,
        val username: String,
        @SerialName("display_name") val displayName: String,
        @SerialName("avatar_id") val avatarId: String? = null,
        val token: String,
    ) {
        val name get() = displayName.ifBlank { username }
    }

    private const val KEY = "accounts"
    private val serializer = ListSerializer(Saved.serializer())

    private val _list = MutableStateFlow(read())
    val list: StateFlow<List<Saved>> = _list

    private fun read(): List<Saved> = try {
        Nexa.secure.getString(KEY)?.let { wireJson.decodeFromString(serializer, it) } ?: emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    private fun write(list: List<Saved>) {
        if (list.isEmpty()) Nexa.secure.delete(KEY) else Nexa.secure.putString(KEY, wireJson.encodeToString(serializer, list))
        _list.value = list
    }

    /** Keeps the account signed in now on the list, with its name and picture as they are. */
    fun remember(me: MeUser, token: String) {
        val entry = Saved(me.id, me.username, me.displayName, me.avatarId, token)
        val list = read()
        write(if (list.any { it.id == me.id }) list.map { if (it.id == me.id) entry else it } else list + entry)
    }

    fun forget(id: String) = write(read().filter { it.id != id })

    /** Drops whichever account held a token the server no longer takes. */
    fun forgetToken(token: String) = write(read().filter { it.token != token })

    fun find(id: String): Saved? = read().firstOrNull { it.id == id }

    fun canAdd(): Boolean = read().size < MAX

    /** After the account open here signed out: the next one to go on with. */
    fun next(): Saved? = read().firstOrNull()
}
