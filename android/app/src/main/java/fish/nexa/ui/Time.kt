package fish.nexa.ui

import android.icu.text.DateFormat
import android.icu.text.MeasureFormat
import android.icu.text.NumberFormat
import android.icu.util.Measure
import android.icu.util.MeasureUnit
import java.util.Calendar
import java.util.Date
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * lib/time.ts: every date and time the app shows, in the app language's own
 * conventions (English shows 12-hour "3:07 PM"). The web's Intl options are
 * ICU skeletons here, which is what Intl uses underneath.
 */
object Time {
    private enum class Kind(val skeleton: String) {
        TIME("jmm"),
        DATE("yyyyMMdd"),
        SHORT_DATE("yMMMd"),
        DAY_MONTH("MMMd"),
        WEEKDAY("EEE"),
        LONG_DATE("yMMMMd"),
        FULL("yMMMMEEEEdjmm"),
        EXACT("yMMMdjmmss"),
    }

    private val cache = HashMap<String, DateFormat>()

    private fun fmt(kind: Kind): DateFormat {
        val locale = I18n.locale
        val key = "${locale.toLanguageTag()}:$kind"
        return synchronized(cache) { cache.getOrPut(key) { DateFormat.getInstanceForSkeleton(kind.skeleton, locale) } }
    }

    private fun format(kind: Kind, ms: Long): String = synchronized(cache) { fmt(kind).format(Date(ms)) }

    fun sameDay(a: Long, b: Long): Boolean {
        val ca = Calendar.getInstance().apply { timeInMillis = a }
        val cb = Calendar.getInstance().apply { timeInMillis = b }
        return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) && ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
    }

    /** "3:07 PM": grouped rows, the new-messages pill. */
    fun time(ms: Long): String = format(Kind.TIME, ms)

    /** "Today at 3:07 PM", "Yesterday at …", "10/02/2026 3:07 PM": beside an author's name. */
    fun timestamp(ms: Long, now: Long = System.currentTimeMillis()): String {
        if (sameDay(ms, now)) return t("time.todayAt", "time" to time(ms))
        val yesterday = Calendar.getInstance().apply { timeInMillis = now; add(Calendar.DATE, -1) }.timeInMillis
        if (sameDay(ms, yesterday)) return t("time.yesterdayAt", "time" to time(ms))
        return t("time.dateAt", "date" to format(Kind.DATE, ms), "time" to time(ms))
    }

    /** "October 2, 2026": date dividers. */
    fun dateDivider(ms: Long): String = format(Kind.LONG_DATE, ms)

    /** "Friday, October 2, 2026 at 3:07 PM". */
    fun full(ms: Long): String = format(Kind.FULL, ms)

    /** "Oct 2, 2026, 3:07:12 PM": the message menu's notes. */
    fun exact(ms: Long): String = format(Kind.EXACT, ms)

    fun shortDate(ms: Long): String = format(Kind.SHORT_DATE, ms)

    /** Lists (search results, pins): the time today, the weekday this week, "Oct 2" this year, else "Oct 2, 2025". */
    fun listWhen(ms: Long, now: Long = System.currentTimeMillis()): String {
        if (sameDay(ms, now)) return time(ms)
        val d = Calendar.getInstance().apply { timeInMillis = ms }
        val n = Calendar.getInstance().apply { timeInMillis = now }
        fun midnight(c: Calendar) = (c.clone() as Calendar).apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val days = (midnight(n) - midnight(d)) / 86_400_000.0
        if (days > 0 && days < 7) return format(Kind.WEEKDAY, ms)
        if (d.get(Calendar.YEAR) == n.get(Calendar.YEAR)) return format(Kind.DAY_MONTH, ms)
        return format(Kind.SHORT_DATE, ms)
    }

    /** "in 3 days" or "3 days ago": a moment either side of now (lib/moderation.ts relativeTo, the `<t:R>` style). */
    fun relativeTo(ms: Long, now: Long = System.currentTimeMillis()): String =
        fish.nexa.ui.markdown.TimeFormat.formatStamp(ms, 'R', now, I18n.locale)

    /** "just now", "5 minutes ago", "2 hours ago", else the date. */
    fun relative(ms: Long, now: Long = System.currentTimeMillis()): String {
        val s = maxOf(0L, ((now - ms) / 1000.0).roundToLong())
        if (s < 45) return t("time.justNow")
        val m = (s / 60.0).roundToLong()
        if (m < 60) return t("time.minutesAgo", "count" to m)
        val h = (m / 60.0).roundToLong()
        if (h < 24) return t("time.hoursAgo", "count" to h)
        return format(Kind.DATE, ms)
    }

    /** "12s", "1m": the slow-mode countdown (Intl narrow units). */
    fun shortDuration(seconds: Double): String {
        val s = maxOf(0L, seconds.roundToLong())
        val (value, unit) = when {
            s >= 3600 && s % 3600 == 0L -> s / 3600 to MeasureUnit.HOUR
            s >= 60 && s % 60 == 0L -> s / 60 to MeasureUnit.MINUTE
            else -> s to MeasureUnit.SECOND
        }
        return try {
            MeasureFormat.getInstance(I18n.locale, MeasureFormat.FormatWidth.NARROW).format(Measure(value, unit))
        } catch (_: Exception) {
            "$value${unit.subtype.first()}"
        }
    }

    private fun round(v: Double, places: Int): String {
        val p = Math.pow(10.0, places.toDouble())
        val r = Math.round(v * p) / p
        return if (r == floor(r)) r.toLong().toString() else r.toString()
    }

    /** "512 B", "1.5 KB", "3.2 MB", "1.25 GB" (base 1024). */
    fun bytes(n: Long): String = when {
        n < 1024 -> t("time.bytes", "n" to n)
        n < 1024L * 1024 -> t("time.kilobytes", "n" to round(n / 1024.0, 1))
        n < 1024L * 1024 * 1024 -> t("time.megabytes", "n" to round(n / (1024.0 * 1024), 1))
        else -> t("time.gigabytes", "n" to round(n / (1024.0 * 1024 * 1024), 2))
    }

    fun compact(n: Long): String = android.icu.text.CompactDecimalFormat.getInstance(I18n.locale, android.icu.text.CompactDecimalFormat.CompactStyle.SHORT).apply { maximumFractionDigits = 1 }.format(n)

    fun percent(p: Double): String = NumberFormat.getPercentInstance(I18n.locale).apply { maximumFractionDigits = 0 }.format(p / 100)

    /** "m:ss" or "h:mm:ss": media and calls. */
    fun duration(seconds: Double): String {
        val s = maxOf(0L, floor(seconds).toLong())
        val m = s / 60
        val h = m / 60
        val mm = (m % 60).toString().padStart(if (h > 0) 2 else 1, '0')
        val ss = (s % 60).toString().padStart(2, '0')
        return if (h > 0) "$h:$mm:$ss" else "$mm:$ss"
    }
}
