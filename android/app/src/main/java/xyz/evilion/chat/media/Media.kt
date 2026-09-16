package xyz.evilion.chat.media

import xyz.evilion.chat.net.Api

/** Where pictures the server keeps in the clear live: avatars, banners, icons, emoji, stickers. */
object Media {
    fun url(kind: String, id: String, size: Int? = null): String =
        Api.url("/media/$kind/$id", if (size != null) mapOf("size" to size.toString()) else emptyMap()).toString()

    fun avatar(avatarId: String?, size: Int = 128): String? = avatarId?.let { url("avatar", it, size) }

    fun banner(bannerId: String?, size: Int = 1024): String? = bannerId?.let { url("banner", it, size) }

    fun icon(iconId: String?, size: Int = 128): String? = iconId?.let { url("icon", it, size) }

    fun emoji(blobId: String, size: Int = 64): String = url("emoji", blobId, size)

    fun sticker(blobId: String, size: Int = 320): String = url("sticker", blobId, size)

    /** The encrypted bytes of an attachment; only this account may fetch them. */
    fun attachment(blobId: String): String = Api.url("/media/attachments/$blobId").toString()
}
