package fish.nexa.media

import android.content.Context
import fish.nexa.Nexa
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** fitMedia.ts and the grid shapes of Attachments.tsx: boxes sized before anything loads, so nothing jumps. */
object Fit {
    data class Box(val width: Int, val height: Int)

    private const val MAX_W = 550
    private const val MAX_H = 350
    private const val VIDEO_MIN_W = 320
    private const val VIDEO_MIN_H = 180

    /** A picture's frame: within 550 x 350, scaled up to 100 on one side when tiny; 400 x 300 with no size. */
    fun media(w: Double?, h: Double?): Box {
        if (w == null || h == null || w <= 0 || h <= 0) return Box(400, 300)
        var r = min(1.0, min(MAX_W / w, MAX_H / h))
        if (w * r < 100 && h * r < 100) r = min(min(100 / w, 100 / h), min(MAX_W / w, MAX_H / h))
        return Box(max(1, (w * r).roundToInt()), max(1, (h * r).roundToInt()))
    }

    /** A video's frame: as a picture, but at least 320 wide and 180 to 350 tall. */
    fun video(w: Double, h: Double): Box {
        val fit = media(w, h)
        val width = max(fit.width, VIDEO_MIN_W)
        val height = min(MAX_H, max(max(VIDEO_MIN_H, fit.height), (width * h / w).roundToInt()))
        return Box(width, height)
    }

    /** Within maxW x maxH, never scaled up (link cards, webhook pictures, post media). */
    fun within(w: Double?, h: Double?, maxW: Int, maxH: Int): Box? {
        if (w == null || h == null || w <= 0 || h <= 0) return null
        val r = min(1.0, min(maxW / w, maxH / h))
        return Box(max(1, (w * r).roundToInt()), max(1, (h * r).roundToInt()))
    }

    /** One tile of the picture grid: columns and rows of a six-column grid, and its aspect (w / h) when fixed. */
    data class Tile(val col: Int, val row: Int, val ratio: Float?)

    fun mosaic(n: Int): List<Tile> {
        val square = Tile(2, 1, 1f)
        val half = Tile(3, 1, 1.5f)
        if (n <= 1) return emptyList()
        if (n == 2) return listOf(Tile(3, 1, 1f), Tile(3, 1, 1f))
        if (n == 3) return listOf(Tile(4, 2, null), square, square)
        if (n == 4) return listOf(half, half, half, half)
        val over = n % 3
        val top = when (over) {
            1 -> listOf(Tile(6, 1, 2f))
            2 -> listOf(half, half)
            else -> emptyList()
        }
        return top + List(n - over) { square }
    }
}

/** mediaPrefs.ts: volume, mute and speed, shared by every player and kept on the device. */
object MediaPrefs {
    data class Prefs(val volume: Float = 1f, val muted: Boolean = false, val speed: Float = 1f)

    private fun prefs() = Nexa.app.getSharedPreferences("media", Context.MODE_PRIVATE)

    fun get(): Prefs = prefs().let { p ->
        Prefs(p.getFloat("volume", 1f).coerceIn(0f, 1f), p.getBoolean("muted", false), p.getFloat("speed", 1f).coerceIn(0.5f, 2f))
    }

    fun save(volume: Float? = null, muted: Boolean? = null, speed: Float? = null) {
        val e = prefs().edit()
        volume?.let { e.putFloat("volume", it.coerceIn(0f, 1f)) }
        muted?.let { e.putBoolean("muted", it) }
        speed?.let { e.putFloat("speed", it.coerceIn(0.5f, 2f)) }
        e.apply()
    }
}
