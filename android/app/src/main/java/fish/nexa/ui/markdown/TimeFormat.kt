package fish.nexa.ui.markdown

import java.time.Instant
import java.time.LocalDate
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

/**
 * The ICU calls dates and numbers need, as JavaScript's Intl makes them: the
 * phone's android.icu in the app ([AndroidIcu]), ICU4J in tests.
 */
interface IcuFormats {
    /** A date in the pattern ICU picks for a skeleton ("yMMMMdjmm"), hour field lengths kept, as Intl.DateTimeFormat does. */
    fun date(skeleton: String, locale: Locale, zone: TimeZone, epochMs: Long): String

    /** Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit), unit one of year month week day hour minute second. */
    fun relative(value: Double, unit: String, locale: Locale): String

    /** Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }). */
    fun compact(n: Double, locale: Locale): String

    /** Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }) of a fraction. */
    fun percent(fraction: Double, locale: Locale): String

    /** Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }), unit second, minute or hour. */
    fun unitNarrow(value: Double, unit: String, locale: Locale): String
}

/**
 * Dates and times in the language the app is set to (lib/time.ts), and the
 * `<t:…>` times written in messages. Every function takes the language and
 * the time zone so it stays a pure function; the app passes the account's
 * language and the phone's zone. Words come from the catalogue through `tr`
 * (key and values, the way `t()` takes them).
 */
object TimeFormat {
    /** The ICU in use; tests set ICU4J's. */
    @Volatile var icu: IcuFormats = AndroidIcu

    private val SKELETONS = mapOf(
        "time" to "jmm",
        "date" to "yMMdd",
        "shortDate" to "yMMMd",
        "dayMonth" to "MMMd",
        "weekday" to "EEE",
        "longDate" to "yMMMMd",
        "full" to "EEEEyMMMMdjmm",
        "exact" to "yMMMdjmmss",
        "stamp:t" to "jmm",
        "stamp:T" to "jmmss",
        "stamp:d" to "yMMdd",
        "stamp:D" to "yMMMMd",
        "stamp:f" to "yMMMMdjmm",
        "stamp:F" to "EEEEyMMMMdjmm",
    )

    private fun fmt(kind: String, ms: Long, locale: Locale, zone: TimeZone): String = icu.date(SKELETONS.getValue(kind), locale, zone, ms)

    private fun day(ms: Long, zone: TimeZone): LocalDate = Instant.ofEpochMilli(ms).atZone(zone.toZoneId()).toLocalDate()

    fun sameDay(a: Long, b: Long, zone: TimeZone = TimeZone.getDefault()): Boolean = day(a, zone) == day(b, zone)

    fun formatTime(ms: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String = fmt("time", ms, locale, zone)

    /** "Today at 4:10 PM", "Yesterday at 9:02 AM", or "09/11/2026 4:10 PM". */
    fun formatTimestamp(ms: Long, now: Long, locale: Locale, tr: (String, Map<String, Any>) -> String, zone: TimeZone = TimeZone.getDefault()): String {
        val time = formatTime(ms, locale, zone)
        if (sameDay(ms, now, zone)) return tr("time.todayAt", mapOf("time" to time))
        // the calendar's yesterday: 24 hours back lands on the wrong day around a daylight-saving change
        if (day(ms, zone) == day(now, zone).minusDays(1)) return tr("time.yesterdayAt", mapOf("time" to time))
        return tr("time.dateAt", mapOf("date" to fmt("date", ms, locale, zone), "time" to time))
    }

    fun formatDateDivider(ms: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String = fmt("longDate", ms, locale, zone)

    fun formatFull(ms: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String = fmt("full", ms, locale, zone)

    /** "Sep 24, 2026, 4:37:12 PM": the very moment, short enough for a line on a phone. */
    fun formatExact(ms: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String = fmt("exact", ms, locale, zone)

    /** As short as a list wants it: the time today, the weekday within a week, day and month this year, else the date. */
    fun formatListWhen(ms: Long, now: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String {
        if (sameDay(ms, now, zone)) return formatTime(ms, locale, zone)
        val d = day(ms, zone)
        val n = day(now, zone)
        val z = zone.toZoneId()
        // midnight to midnight, as the web measures it, so a daylight-saving week is not a whole number of days
        val days = (n.atStartOfDay(z).toInstant().toEpochMilli() - d.atStartOfDay(z).toInstant().toEpochMilli()) / 86_400_000.0
        if (days > 0 && days < 7) return fmt("weekday", ms, locale, zone)
        if (d.year == n.year) return fmt("dayMonth", ms, locale, zone)
        return fmt("shortDate", ms, locale, zone)
    }

    /** "Sep 24, 2026", a date on its own. */
    fun formatShortDate(ms: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String = fmt("shortDate", ms, locale, zone)

    /** A short span in the reader's language ("5s", "2m", "1h"), whole minutes and hours read as those. */
    fun formatShortDuration(seconds: Double, locale: Locale): String {
        val s = max(0.0, jsRound(seconds)).toLong()
        val (value, unit) = when {
            s >= 3600 && s % 3600 == 0L -> s / 3600 to "hour"
            s >= 60 && s % 60 == 0L -> s / 60 to "minute"
            else -> s to "second"
        }
        return try {
            icu.unitNarrow(value.toDouble(), unit, locale)
        } catch (_: Exception) {
            "$value${unit[0]}"
        }
    }

    /** A size as the box shows it ("12 KB"), the number in the reader's digits by `tr`. */
    fun formatBytes(n: Double, tr: (String, Map<String, Any>) -> String): String {
        if (n < 1024) return tr("time.bytes", mapOf("n" to n))
        if (n < 1024.0 * 1024) return tr("time.kilobytes", mapOf("n" to roundTo(n / 1024, 1)))
        if (n < 1024.0 * 1024 * 1024) return tr("time.megabytes", mapOf("n" to roundTo(n / (1024.0 * 1024), 1)))
        return tr("time.gigabytes", mapOf("n" to roundTo(n / (1024.0 * 1024 * 1024), 2)))
    }

    /** `Number(v.toFixed(places))`. */
    private fun roundTo(v: Double, places: Int): Double = java.math.BigDecimal(v).setScale(places, java.math.RoundingMode.HALF_UP).toDouble()

    /** A count in few characters, "1.2K" or "3.4M" as the language writes them. */
    fun formatCompact(n: Double, locale: Locale): String = icu.compact(n, locale)

    /** A share out of a hundred, "75%" as the language writes it. */
    fun formatPercent(percent: Double, locale: Locale): String = icu.percent(percent / 100, locale)

    /** A media time, "4:05" or "1:02:03". */
    fun formatDuration(seconds: Double): String {
        val s = max(0.0, floor(seconds)).toLong()
        val m = s / 60
        val h = m / 60
        val mm = (m % 60).toString().padStart(if (h > 0) 2 else 1, '0')
        val ss = (s % 60).toString().padStart(2, '0')
        return if (h > 0) "$h:$mm:$ss" else "$mm:$ss"
    }

    private val RELATIVE_UNITS = listOf("year" to 31557600.0, "month" to 2629800.0, "week" to 604800.0, "day" to 86400.0, "hour" to 3600.0, "minute" to 60.0, "second" to 1.0)

    /** JavaScript's Math.round: halves go up. */
    private fun jsRound(v: Double): Double = floor(v + 0.5)

    /**
     * A `<t:…>` time written in a message, in the app's language: styles t T d
     * D f F as dates, R as "in 5 minutes" counted from `now`.
     */
    fun formatStamp(ms: Long, style: Char, now: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String {
        if (style != 'R') return fmt("stamp:$style", ms, locale, zone)
        val delta = ms / 1000.0 - now / 1000.0
        val a = abs(delta)
        for ((unit, seconds) in RELATIVE_UNITS) {
            if (a >= seconds || unit == "second") return icu.relative(jsRound(delta / seconds), unit, locale)
        }
        return ""
    }

    /** "just now", "5 minutes ago", "2 hours ago", or the date for anything older than a day. */
    fun formatRelative(ms: Long, now: Long, locale: Locale, tr: (String, Map<String, Any>) -> String, zone: TimeZone = TimeZone.getDefault()): String {
        val s = max(0.0, jsRound((now - ms) / 1000.0))
        if (s < 45) return tr("time.justNow", emptyMap())
        val m = jsRound(s / 60).toLong()
        if (m < 60) return tr("time.minutesAgo", mapOf("count" to m))
        val h = jsRound(m / 60.0).toLong()
        if (h < 24) return tr("time.hoursAgo", mapOf("count" to h))
        return fmt("date", ms, locale, zone)
    }
}

/**
 * The `<t:unix:style>` node as the renderer shows it (render.tsx Timestamp):
 * its words, its full form for a long press, and when a relative one should
 * be read again.
 */
object Timestamps {
    /** The latest and earliest moments a JavaScript Date can hold, in ms. */
    private const val MAX_MS = 8.64e15

    /** Whether the time is one a date can hold; one that is not reads as its number. */
    fun valid(unix: Double): Boolean = !unix.isNaN() && abs(unix * 1000) <= MAX_MS

    /** The words for a timestamp in a message. */
    fun text(node: Node.Timestamp, now: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String =
        if (!valid(node.unix)) Js.numberToString(node.unix) else TimeFormat.formatStamp(epochMs(node.unix), node.style, now, locale, zone)

    /** Its full form (style F), shown when it is held. Null when it is no date. */
    fun title(node: Node.Timestamp, now: Long, locale: Locale, zone: TimeZone = TimeZone.getDefault()): String? =
        if (!valid(node.unix)) null else TimeFormat.formatStamp(epochMs(node.unix), 'F', now, locale, zone)

    /** `unix * 1000` as the whole milliseconds a Date keeps. */
    fun epochMs(unix: Double): Long = (unix * 1000).let { if (it < 0) -floor(-it) else floor(it) }.toLong()

    /** How soon a relative time ("in 5 minutes") can read differently: often while close, rarely once far. */
    fun relativeTick(deltaMs: Long): Long {
        val away = abs(deltaMs)
        return if (away < 60_000) 10_000 else if (away < 3_600_000) 30_000 else if (away < 86_400_000) 60_000 else 3_600_000
    }
}
