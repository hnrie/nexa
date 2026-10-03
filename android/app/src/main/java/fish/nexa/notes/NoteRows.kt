package fish.nexa.notes

import fish.nexa.net.PublicUser
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** What a member of a note may do: read it, edit it, or own it. A higher role includes the ones below. */
object NoteRole {
    const val VIEWER = 1
    const val EDITOR = 2
    const val OWNER = 3
}

/**
 * A note as the server keeps it for one of its members (web/src/api/types.ts
 * NoteRow). `head` and `body` are sealed with the note's key, and
 * `keySealed` is that key sealed to this account; the server can read none of it.
 */
@Serializable
data class NoteRow(
    val id: String,
    @SerialName("owner_id") val ownerId: String,
    val head: String,
    /** Left out of lists; fetched when the note is opened. */
    val body: String? = null,
    /** Counts saves. A save names the version it was made from. */
    val version: Int,
    @SerialName("edited_by") val editedBy: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("updated_at") val updatedAt: Long = 0,
    val role: Int,
    @SerialName("key_sealed") val keySealed: String,
    /** Counts the note's keys: `keySealed` is the key of this epoch. */
    @SerialName("key_epoch") val keyEpoch: Int = 0,
    /** How many people the note is shared with, its owner included. */
    val members: Int = 1,
    /** Someone who held the note's key is no longer in it: the owner's app gives it a new key. */
    @SerialName("needs_rekey") val needsRekey: Boolean = false,
    @SerialName("crdt_seq") val crdtSeq: Long = 0,
    /** The newest change the saved note (`body`) already holds. */
    @SerialName("crdt_upto") val crdtUpto: Long = 0,
)

@Serializable
data class NoteList(val notes: List<NoteRow> = emptyList(), val invites: List<NoteInviteRow> = emptyList())

/** An invitation to a note, as the person invited gets it. */
@Serializable
data class NoteInviteRow(
    val id: String,
    @SerialName("note_id") val noteId: String,
    val role: Int,
    @SerialName("key_sealed") val keySealed: String = "",
    val head: String = "",
    @SerialName("created_at") val createdAt: Long = 0,
    val from: PublicUser,
)

@Serializable
data class NoteUpdateRow(
    val seq: Long,
    val update: String,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class NoteUpdates(
    val updates: List<NoteUpdateRow> = emptyList(),
    @SerialName("crdt_seq") val crdtSeq: Long = 0,
    @SerialName("crdt_upto") val crdtUpto: Long = 0,
    val more: Boolean = false,
)

/** An earlier state of a note, sealed with the key the note had then. */
@Serializable
data class NoteVersionRow(
    val id: String,
    @SerialName("note_id") val noteId: String = "",
    val version: Int = 0,
    val head: String = "",
    val body: String? = null,
    @SerialName("key_epoch") val keyEpoch: Int = 0,
    @SerialName("edited_by") val editedBy: String? = null,
    @SerialName("saved_at") val savedAt: Long = 0,
)

@Serializable
data class NoteKeyRow(val epoch: Int, val wrapped: String)

@Serializable
data class NoteVersions(val versions: List<NoteVersionRow> = emptyList(), val keys: List<NoteKeyRow> = emptyList())

@Serializable
data class NoteLinkRow(
    val id: String,
    @SerialName("note_id") val noteId: String = "",
    val role: Int,
    @SerialName("key_wrapped") val keyWrapped: String = "",
    /** The link itself, sealed with the note's key, for its owner to copy again. */
    @SerialName("link_sealed") val linkSealed: String = "",
    @SerialName("created_by") val createdBy: String? = null,
    val uses: Int = 0,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class NoteMember(val user: PublicUser, val role: Int, @SerialName("created_at") val createdAt: Long = 0)

@Serializable
data class NoteSentInvite(val id: String, val role: Int, @SerialName("created_at") val createdAt: Long = 0, val user: PublicUser)

/** Who a note is shared with. Invitations and links are only sent to its owner. */
@Serializable
data class NoteSharing(
    val members: List<NoteMember> = emptyList(),
    val invites: List<NoteSentInvite> = emptyList(),
    val links: List<NoteLinkRow> = emptyList(),
)

/** What a share link leads to, for whoever holds it. */
@Serializable
data class NoteLinkView(
    @SerialName("note_id") val noteId: String,
    val role: Int,
    @SerialName("key_wrapped") val keyWrapped: String,
    val head: String,
    @SerialName("updated_at") val updatedAt: Long = 0,
    val members: Int = 1,
    /** This account's role in the note already, or 0. */
    @SerialName("member_role") val memberRole: Int = 0,
    val owner: PublicUser? = null,
)
