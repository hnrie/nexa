package fish.nexa.ui.voice

import android.content.Context
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.viewinterop.AndroidView
import fish.nexa.voice.WebRtc
import org.webrtc.EglBase
import org.webrtc.EglRenderer
import org.webrtc.GlRectDrawer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoTrack

/**
 * One call picture: a TextureView that libwebrtc's renderer draws into, so it
 * clips to a tile's rounded corners and takes transforms (a mirror, a pinch)
 * like any other view. It fills its box, cropping the picture to the box's
 * shape; a picture to be seen whole is given a box of its own shape.
 */
private class VideoTextureView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener, VideoSink {
    private val renderer = EglRenderer("call-tile")
    private val main = Handler(Looper.getMainLooper())
    private var track: VideoTrack? = null
    private var released = false
    private var lastW = 0
    private var lastH = 0
    var onAspect: ((Float) -> Unit)? = null

    init {
        surfaceTextureListener = this
        renderer.init(WebRtc.eglBase.eglBaseContext, EglBase.CONFIG_PLAIN, GlRectDrawer())
        isOpaque = false
    }

    fun setTrack(next: VideoTrack?) {
        if (next === track || released) return
        track?.let { runCatching { it.removeSink(this) } }
        track = next
        runCatching { renderer.clearImage() }
        next?.let { runCatching { it.addSink(this) } }
    }

    fun setMirror(on: Boolean) = renderer.setMirror(on)

    override fun onFrame(frame: VideoFrame) {
        val w = frame.rotatedWidth
        val h = frame.rotatedHeight
        if ((w != lastW || h != lastH) && w > 0 && h > 0) {
            lastW = w
            lastH = h
            // the size comes from whoever sends the picture, so its shape is held to a sane range
            val ratio = (w.toFloat() / h).coerceIn(9f / 21f, 21f / 9f)
            main.post { onAspect?.invoke(ratio) }
        }
        renderer.onFrame(frame)
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        if (released) return
        renderer.createEglSurface(surface)
        renderer.setLayoutAspectRatio(if (height > 0) width.toFloat() / height else 0f)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        renderer.setLayoutAspectRatio(if (height > 0) width.toFloat() / height else 0f)
    }

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        val done = java.util.concurrent.CountDownLatch(1)
        renderer.releaseEglSurface { done.countDown() }
        runCatching { done.await(500, java.util.concurrent.TimeUnit.MILLISECONDS) }
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit

    fun release() {
        if (released) return
        released = true
        track?.let { runCatching { it.removeSink(this) } }
        track = null
        onAspect = null
        renderer.release()
    }
}

/**
 * A call picture in Compose. `whole` keeps the picture's own shape inside the
 * box (a share, a focused stream); otherwise it covers the box. `zoomable`
 * lets two fingers pinch into it and one drag it about once zoomed.
 */
@Composable
fun VideoSurface(
    track: VideoTrack,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
    whole: Boolean = false,
    zoomable: Boolean = false,
    onAspect: ((Float) -> Unit)? = null,
    onZoom: ((Boolean) -> Unit)? = null,
) {
    var aspect by remember(track) { mutableFloatStateOf(0f) }
    var box by remember { mutableStateOf(IntSize.Zero) }
    var scale by remember(track) { mutableFloatStateOf(1f) }
    var offset by remember(track) { mutableStateOf(Offset.Zero) }
    LaunchedEffect(zoomable) {
        if (!zoomable) {
            if (scale > 1f) onZoom?.invoke(false)
            scale = 1f
            offset = Offset.Zero
        }
    }
    val gestures = if (!zoomable) Modifier else Modifier.pointerInput(track) {
        detectTransformGestures { centroid, pan, zoom, _ ->
            val next = (scale * zoom).coerceIn(1f, 6f)
            // zoom about the fingers, then keep the picture covering the box
            val c = centroid - Offset(box.width / 2f, box.height / 2f)
            var o = (offset - c) * (next / scale) + c + pan
            val maxX = box.width * (next - 1) / 2f
            val maxY = box.height * (next - 1) / 2f
            o = Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
            if ((next > 1f) != (scale > 1f)) onZoom?.invoke(next > 1f)
            scale = next
            offset = if (next <= 1f) Offset.Zero else o
        }
    }
    Box(modifier.onSizeChanged { box = it }.then(gestures), contentAlignment = Alignment.Center) {
        val inner = if (whole && aspect > 0f) Modifier.aspectRatio(aspect) else Modifier.fillMaxSize()
        AndroidView(
            factory = { ctx -> VideoTextureView(ctx) },
            update = { v ->
                v.onAspect = { r ->
                    aspect = r
                    onAspect?.invoke(r)
                }
                v.setMirror(mirror)
                v.setTrack(track)
            },
            onRelease = { it.release() },
            modifier = inner.graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
        )
    }
}
