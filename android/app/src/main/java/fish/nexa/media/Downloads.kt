package fish.nexa.media

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
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
 * goes to Downloads, a picture to Pictures/Nexa, each written as it is
 * decrypted so a big video is never whole in memory. Android 9 and older ask
 * where to put it instead, through the system's save sheet.
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
                FileCrypto.decryptStream(input, Bytes.unb64(att.key), out, expectedSize = att.size) { done -> onProgress(done) }
            }
        }
    }

    /** A new item in the shared Downloads (or Pictures) collection, hidden until it is whole. */
    internal fun insert(name: String, type: String, picture: Boolean): Uri? {
        if (Build.VERSION.SDK_INT < 29) return null
        val cr = Nexa.app.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, type.ifEmpty { "application/octet-stream" })
            put(MediaStore.MediaColumns.RELATIVE_PATH, if (picture) "${Environment.DIRECTORY_PICTURES}/Nexa" else Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = if (picture) MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        return cr.insert(collection, values)
    }

    private fun finish(uri: Uri) {
        if (Build.VERSION.SDK_INT < 29) return
        Nexa.app.contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    }

    /** Writes into a place the person picked (Android 9 and older) or a new shared item (10 and later). */
    suspend fun saveInto(uri: Uri, write: suspend (OutputStream) -> Unit, pending: Boolean) {
        val cr = Nexa.app.contentResolver
        try {
            withContext(Dispatchers.IO) { cr.openOutputStream(uri, "w")?.use { write(it) } ?: throw java.io.IOException("could not write there") }
            if (pending) finish(uri)
        } catch (e: Exception) {
            if (pending) runCatching { cr.delete(uri, null, null) }
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
 * Saving: on Android 10 and later straight into Downloads or Pictures; on 9
 * and older through the system's save sheet, opened from the activity the
 * person is looking at. [onDone] gets null on success, the reason it failed,
 * or nothing at all when the person backed out of the save sheet.
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

    fun save(name: String, type: String, picture: Boolean, write: suspend (OutputStream) -> Unit, onDone: (Throwable?) -> Unit) {
        if (Build.VERSION.SDK_INT >= 29) {
            Nexa.scope.launch {
                val err = runCatching {
                    val uri = withContext(Dispatchers.IO) { Downloads.insert(name, type, picture) } ?: throw java.io.IOException("no room")
                    Downloads.saveInto(uri, write, pending = true)
                }.exceptionOrNull()
                withContext(Dispatchers.Main) { onDone(err) }
            }
            return
        }
        val act = activity?.get() ?: return onDone(java.io.IOException("no window to save from"))
        val key = "nexa-save-${seq++}"
        var launcher: androidx.activity.result.ActivityResultLauncher<String>? = null
        launcher = act.activityResultRegistry.register(key, ActivityResultContracts.CreateDocument(type.ifEmpty { "application/octet-stream" })) { uri ->
            launcher?.unregister()
            if (uri == null) return@register
            Nexa.scope.launch {
                val err = runCatching { Downloads.saveInto(uri, write, pending = false) }.exceptionOrNull()
                withContext(Dispatchers.Main) { onDone(err) }
            }
        }
        launcher.launch(name)
    }
}
