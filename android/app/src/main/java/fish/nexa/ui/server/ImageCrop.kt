package fish.nexa.ui.server

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import fish.nexa.ui.Icon
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxCheckbox
import fish.nexa.ui.components.NxSlider
import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** What the crop dialog hands back: the bytes to upload, and with serverCrop the part framed. */
class CropResult(val bytes: ByteArray, val type: String, val original: Boolean, val crop: CropRect? = null)

/** The framed part, in the picture's own pixels. */
data class CropRect(val x: Int, val y: Int, val w: Int, val h: Int)

/** lib/animatedImage.ts: whether the start of a file says it animates. */
object Animated {
    fun byType(type: String) = type == "image/gif" || type == "image/apng"

    private fun tag(b: ByteArray, at: Int): String = buildString { for (i in 0 until 4) append(((b.getOrNull(at + i)?.toInt() ?: 0) and 0xff).toChar()) }

    fun bytes(type: String, b: ByteArray): Boolean {
        if (byType(type)) return true
        if (type == "image/webp") {
            // an extended WebP (VP8X) marks animation with bit 0x02 of its flags
            return tag(b, 0) == "RIFF" && tag(b, 8) == "WEBP" && tag(b, 12) == "VP8X" && ((b.getOrNull(20)?.toInt() ?: 0) and 0x02) != 0
        }
        if (type == "image/png") {
            // an animated PNG has an acTL chunk before its first image data
            if (tag(b, 0) != "\u0089PNG") return false
            var at = 8
            while (at + 8 <= b.size) {
                val kind = tag(b, at + 4)
                if (kind == "acTL") return true
                if (kind == "IDAT" || kind == "IEND") return false
                val len = ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)
                if (len < 0) return false
                at += 12 + len
            }
        }
        return false
    }
}

/**
 * ImageCropModal: pan the picture under a frame (round for icons), zoom with
 * a pinch or the slider, and Apply. A moving picture can go up whole instead
 * of flattened; with [serverCrop] the file goes whole with the framed part and
 * the server cuts it, so it keeps moving.
 */
fun openImageCrop(
    file: Picked,
    aspect: Float,
    round: Boolean,
    title: String,
    maxSize: Int = 1024,
    serverCrop: Boolean = false,
    onDone: (CropResult) -> Unit,
) {
    lateinit var layer: Layer
    layer = Layer("imageCrop") { close -> CropSheet(layer, file, aspect, round, title, maxSize, serverCrop, onDone, close) }
    Layers.open(layer)
}

private class Decoded(val bitmap: Bitmap, val sample: Int)

@Composable
private fun CropSheet(
    layer: Layer,
    file: Picked,
    aspect: Float,
    round: Boolean,
    title: String,
    maxSize: Int,
    serverCrop: Boolean,
    onDone: (CropResult) -> Unit,
    close: () -> Unit,
) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var img by remember { mutableStateOf<Decoded?>(null) }
    var image by remember { mutableStateOf<ImageBitmap?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val animated = remember { Animated.bytes(file.type, file.bytes.copyOfRange(0, min(file.bytes.size, 64 * 1024))) }
    var keepOriginal by remember { mutableStateOf(animated && !serverCrop) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var busy by remember { mutableStateOf(false) }
    var boxW by remember { mutableFloatStateOf(1f) }

    LaunchedEffect(file) {
        val d = withContext(Dispatchers.Default) { decode(file.bytes) }
        if (d == null) error = t("common.imageCrop.thatPictureCouldNotBeOpened")
        else {
            img = d
            image = d.bitmap.asImageBitmap()
        }
    }

    val boxH = boxW / aspect
    val iw = img?.bitmap?.width?.toFloat() ?: 1f
    val ih = img?.bitmap?.height?.toFloat() ?: 1f
    val baseScale = max(boxW / iw, boxH / ih)
    val scale = baseScale * zoom
    fun clamp(o: Offset, sc: Float): Offset {
        val maxX = max(0f, (iw * sc - boxW) / 2)
        val maxY = max(0f, (ih * sc - boxH) / 2)
        return Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
    }

    fun apply() {
        if (keepOriginal) {
            close()
            onDone(CropResult(file.bytes, file.type, original = true))
            return
        }
        val d = img ?: return
        if (serverCrop) {
            // where the frame sits on the picture, in the picture's own pixels
            val x = max(0, (((iw * scale - boxW) / 2 - offset.x) / scale).roundToInt())
            val y = max(0, (((ih * scale - boxH) / 2 - offset.y) / scale).roundToInt())
            val w = max(1, min(iw.toInt() - x, (boxW / scale).roundToInt()))
            val h = max(1, min(ih.toInt() - y, (boxH / scale).roundToInt()))
            val s = d.sample
            close()
            onDone(CropResult(file.bytes, file.type, original = true, crop = CropRect(x * s, y * s, w * s, h * s)))
            return
        }
        busy = true
        error = null
        val o = offset
        val sc = scale
        val bw = boxW
        scope.launch {
            val png = withContext(Dispatchers.Default) {
                try {
                    // the web's sizes: four times its 320-pixel frame when the picture covers it, never past maxSize
                    val outW = min(maxSize, (320f * (if (iw * sc >= bw) 4 else 1)).roundToInt())
                    val w = min(maxSize, max(128, outW))
                    val h = (w / aspect).roundToInt()
                    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    val k = w / bw
                    val dw = iw * sc * k
                    val dh = ih * sc * k
                    val left = (w - dw) / 2 + o.x * k
                    val top = (h - dh) / 2 + o.y * k
                    Canvas(out).drawBitmap(d.bitmap, null, RectF(left, top, left + dw, top + dh), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
                    ByteArrayOutputStream().use { bos ->
                        out.compress(Bitmap.CompressFormat.PNG, 100, bos)
                        out.recycle()
                        bos.toByteArray()
                    }
                } catch (_: Throwable) {
                    null
                }
            }
            busy = false
            if (png == null) error = t("common.imageCrop.thatPictureCouldNotBeCropped")
            else {
                close()
                onDone(CropResult(png, "image/png", original = false))
            }
        }
    }

    Sheet(
        layer,
        title = title,
        maxWidth = 440.dp,
        footer = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
                NxButton(t("common.imageCrop.apply"), { apply() }, enabled = img != null, loading = busy)
            }
        },
    ) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val density = LocalDensity.current
            BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                val wDp = min(maxWidth.value, 320f).dp
                val hDp = (wDp.value / aspect).dp
                LaunchedEffect(wDp) { boxW = with(density) { wDp.toPx() } }
                val shape = if (round) CircleShape else Radii.Sm
                Box(
                    Modifier
                        .size(wDp, hDp)
                        .clip(shape)
                        .background(c.bgInput)
                        .pointerInput(img, keepOriginal, boxW) {
                            detectTransformGestures { _, pan, gesture, _ ->
                                if (keepOriginal) return@detectTransformGestures
                                val nz = (zoom * gesture).coerceIn(1f, 5f)
                                zoom = nz
                                offset = clamp(offset + pan, baseScale * nz)
                            }
                        },
                ) {
                    val bmp = image
                    if (bmp != null) Canvas(Modifier.matchParentSize().alpha(if (keepOriginal) 0.55f else 1f)) {
                        val o = clamp(offset, scale)
                        val dw = iw * scale
                        val dh = ih * scale
                        drawImage(
                            bmp,
                            srcOffset = IntOffset.Zero,
                            srcSize = IntSize(bmp.width, bmp.height),
                            dstOffset = IntOffset(((size.width - dw) / 2 + o.x).roundToInt(), ((size.height - dh) / 2 + o.y).roundToInt()),
                            dstSize = IntSize(dw.roundToInt(), dh.roundToInt()),
                            filterQuality = FilterQuality.High,
                        )
                    }
                    Box(Modifier.matchParentSize().border(2.dp, c.brand, shape))
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon("ZoomIn", c.textMuted, size = 16.dp)
                Box(Modifier.weight(1f).alpha(if (keepOriginal) 0.5f else 1f)) {
                    NxSlider(zoom, { if (!keepOriginal) { zoom = it; offset = clamp(offset, baseScale * it) } }, 1f..5f, label = t("common.imageCrop.zoom"))
                }
                IconButton("RotateCcw", t("common.imageCrop.reset"), { zoom = 1f; offset = Offset.Zero }, tint = c.textMuted, iconSize = 16.dp)
            }
            if (animated && !serverCrop) NxCheckbox(keepOriginal, { keepOriginal = it }, t("common.imageCrop.uploadTheOriginalSoItKeeps"))
            error?.let { Txt(it, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textDanger, align = TextAlign.Center) }
            Txt(t("android.server.cropHint"), style = Nx.type.hint, color = c.textMuted, align = TextAlign.Center)
            if (animated && serverCrop) Txt(t("common.imageCrop.keepsMoving"), style = Nx.type.hint, color = c.textMuted, align = TextAlign.Center)
        }
    }
}

/** Decodes at most 4096 px on the long edge; the sample factor maps back to the file's own pixels. */
private fun decode(bytes: ByteArray): Decoded? = try {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null
    else {
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        bmp?.let { Decoded(fish.nexa.media.PhotoOrientation.apply(it, fish.nexa.media.PhotoOrientation.of(bytes)), sample) }
    }
} catch (_: Throwable) {
    null
}
