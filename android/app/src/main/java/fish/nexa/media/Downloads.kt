package fish.nexa.media

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.core.content.FileProvider
import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.FileCrypto
import fish.nexa.net.ApiError
import fish.nexa.ui.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.OutputStream

/**
 * Saving files to the phone (lib/download.ts, lib/imageActions.ts): a file
 * goes to the location chosen in the system's save sheet, written as it is
 * decrypted so a big video is never whole in memory.
 */
object Downloads {
    private fun extOf(name: String, type: String): String =
        name.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= 12 } ?: MimeTypeMap.getSingleton().getExtensionFromMimeType(type) ?: "bin"

    /** Writes an attachment into [out]: from the cache when it was opened already, else straight from the server. */
    suspend fun writeAttachment(att: AttachmentMeta, out: OutputStream, onProgress: (Long) -> Unit) = withContext(Dispatchers.IO) {
        Media.cached(att.blobId, att.plain)?.let { f ->
            f.inputStream().use { input ->
                val buf = ByteArray(1 shl 16)
                var done = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    onProgress(done)
                }
            }
            return@withContext
        }
        val req = Nexa.api.requestBuilder("/media/attachments/${att.blobId}").get().build()
        Nexa.api.await(Nexa.api.transfer.newCall(req)).use { r ->
            if (!r.isSuccessful) throw ApiError(r.code, "http_${r.code}", t("chat.attachments.couldNotDownloadThatFile"))
            val input = r.body.byteStream().buffered(1 shl 16)
            if (att.plain) {
                val buf = ByteArray(1 shl 16)
                var done = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    onProgress(done)
                }
            } else {
                val len = r.body.contentLength()
                if (len >= 0 && r.header("Content-Encoding") == null && len != FileCrypto.encryptedSize(att.size)) throw DecryptError("file: the server sent a file of another size")
                withReadAhead(input) { ahead ->
                    FileCrypto.decryptStream(ahead.buffered(1 shl 16), Bytes.unb64(att.key), out, expectedSize = att.size) { done -> onProgress(done) }
                }
            }
        }
    }

    /** Writes into the location the person picked, removing a partial file on failure. */
    suspend fun saveInto(uri: Uri, write: suspend (OutputStream) -> Unit) {
        val cr = Nexa.app.contentResolver
        try {
            withContext(Dispatchers.IO) { cr.openOutputStream(uri, "w")?.use { write(it) } ?: throw java.io.IOException("could not write there") }
        } catch (e: Exception) {
            runCatching { android.provider.DocumentsContract.deleteDocument(cr, uri) }
            throw e
        }
    }

    /** Copies a picture so another app can paste it: through the clipboard, as a picture of its own type. */
    fun copyImage(file: File, name: String, type: String) {
        val ctx = Nexa.app
        val dir = File(ctx.cacheDir, "shared").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "picture.${extOf(name, type)}")
        file.copyTo(out, overwrite = true)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", out)
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newUri(ctx.contentResolver, name, uri))
    }
}

/**
 * Saving through the system's save sheet on every Android version, opened
 * from the activity the person is looking at. [onDone] gets null on success, the reason it failed,
 * and [onCancel] runs when the person backs out of the save sheet.
 */
object Saving {
    private var activity: java.lang.ref.WeakReference<androidx.activity.ComponentActivity>? = null
    private var seq = 0

    /** Called from what draws media, so a save always has an activity to open its sheet from. */
    @Composable
    fun Track() {
        val ctx = androidx.compose.ui.platform.LocalContext.current
        androidx.compose.runtime.SideEffect {
            (ctx as? androidx.activity.ComponentActivity)?.let { if (activity?.get() !== it) activity = java.lang.ref.WeakReference(it) }
        }
    }

    fun save(name: String, type: String, write: suspend (OutputStream) -> Unit, onCancel: () -> Unit = {}, onDone: (Throwable?) -> Unit) {
        val act = activity?.get() ?: return onDone(java.io.IOException("no window to save from"))
        val key = "nexa-save-${seq++}"
        var launcher: androidx.activity.result.ActivityResultLauncher<String>? = null
        launcher = act.activityResultRegistry.register(key, ActivityResultContracts.CreateDocument(type.ifEmpty { "application/octet-stream" })) { uri ->
            launcher?.unregister()
            if (uri == null) { onCancel(); return@register }
            Nexa.scope.launch {
                val err = runCatching { Downloads.saveInto(uri, write) }.exceptionOrNull()
                withContext(Dispatchers.Main) { onDone(err) }
            }
        }
        try {
            launcher.launch(name)
        } catch (e: Exception) {
            launcher.unregister()
            onDone(e)
        }
    }
}
