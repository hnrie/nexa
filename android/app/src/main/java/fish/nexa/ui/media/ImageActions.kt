package fish.nexa.ui.media

import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.data.ChatMessage
import fish.nexa.media.Downloads
import fish.nexa.media.Priority
import fish.nexa.media.Saving
import fish.nexa.media.loadAttachment
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File

/**
 * A picture a menu was opened on (lib/imageActions.ts): an attachment, whose
 * whole picture is fetched for Copy and Save even when the chat showed its
 * small copy, or a picture address from a link preview or a post.
 */
data class ImageTarget(val att: AttachmentMeta?, val src: String?, val name: String, val type: String?, val cm: ChatMessage? = null)

/** The whole picture as a file on this device: the decrypted attachment, or the preview's picture fetched once. */
private suspend fun fullPicture(image: ImageTarget): Pair<File, String> {
    image.att?.let { att -> return loadAttachment(att, Priority.OPEN) to att.type }
    val src = image.src ?: throw IllegalStateException("no picture")
    return withContext(Dispatchers.IO) {
        val dir = File(Nexa.app.cacheDir, "linked").apply { mkdirs() }
        val out = File(dir, src.hashCode().toUInt().toString(16))
        var type = image.type ?: ""
        if (!out.exists() || out.length() == 0L) {
            Nexa.api.http.newCall(Request.Builder().url(src).build()).execute().use { r ->
                if (!r.isSuccessful) throw java.io.IOException("http ${r.code}")
                type = r.header("Content-Type")?.substringBefore(';')?.trim() ?: type
                val tmp = File(dir, out.name + ".part")
                tmp.outputStream().use { r.body.byteStream().copyTo(it) }
                tmp.renameTo(out)
            }
        }
        out to type.ifEmpty { "image/png" }
    }
}

/**
 * Copy Image and Save Image, put first in the menu of a message opened on one
 * of its pictures (a line under them, before the message's own actions), or
 * alone in the viewer's menu.
 */
fun imageMenuItems(image: ImageTarget, separatorAfter: Boolean = true): List<MenuItem> = listOf(
    MenuItem.Action(t("chat.messageMenu.copyImage")) {
        Nexa.scope.launch {
            try {
                val (file, type) = fullPicture(image)
                withContext(Dispatchers.IO) { Downloads.copyImage(file, image.name, type) }
                // Android 13 and later show their own copied notice
                if (android.os.Build.VERSION.SDK_INT < 33) Nexa.ui.toast(t("chat.messageMenu.imageCopied"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(t("chat.messageMenu.couldNotCopyThePicture"), "error")
            }
        }
    },
    MenuItem.Action(t("chat.messageMenu.saveImage"), separatorAfter = separatorAfter) {
        Nexa.scope.launch {
            try {
                val (file, type) = fullPicture(image)
                withContext(Dispatchers.Main) {
                    Saving.save(image.name, type, picture = true, write = { out -> withContext(Dispatchers.IO) { file.inputStream().use { it.copyTo(out) } } }) { err ->
                        if (err != null) Nexa.ui.toast(t("chat.messageMenu.couldNotSaveThePicture"), "error")
                        else Nexa.ui.toast(t("android.media.savedToPictures"), "success")
                    }
                }
            } catch (e: Exception) {
                Nexa.ui.toast(t("chat.messageMenu.couldNotSaveThePicture"), "error")
            }
        }
    },
)
