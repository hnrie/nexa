package fish.nexa.markdown

import com.ibm.icu.number.Notation
import com.ibm.icu.number.NumberFormatter
import com.ibm.icu.number.Precision
import com.ibm.icu.text.DateTimePatternGenerator
import com.ibm.icu.text.DisplayContext
import com.ibm.icu.text.MeasureFormat
import com.ibm.icu.text.NumberFormat
import com.ibm.icu.text.RelativeDateTimeFormatter
import com.ibm.icu.text.SimpleDateFormat
import com.ibm.icu.util.Measure
import com.ibm.icu.util.MeasureUnit
import com.ibm.icu.util.ULocale
import fish.nexa.ui.markdown.IcuFormats
import fish.nexa.ui.markdown.Node
import fish.nexa.ui.markdown.TimeFormat
import fish.nexa.ui.markdown.Timestamps
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

/**
 * Dates and `<t:…>` times (lib/time.ts), against the web's Intl, with ICU4J
 * 78 (the ICU the generating Node was built with) standing in for android.icu:
 * the same calls the app makes, through [IcuFormats].
 */
class TimeVectorsTest {
    /** The app's [fish.nexa.ui.markdown.AndroidIcu], call for call, in ICU4J. */
    object Icu4j : IcuFormats {
        override fun date(skeleton: String, locale: Locale, zone: TimeZone, epochMs: Long): String {
            val pattern = DateTimePatternGenerator.getInstance(ULocale.forLocale(locale)).getBestPattern(skeleton, DateTimePatternGenerator.MATCH_HOUR_FIELD_LENGTH)
            val f = SimpleDateFormat(pattern, ULocale.forLocale(locale))
            f.timeZone = com.ibm.icu.util.TimeZone.getTimeZone(zone.id)
            return fish.nexa.ui.markdown.AndroidIcu.webSpaces(f.format(java.util.Date(epochMs)))
        }

        override fun relative(value: Double, unit: String, locale: Locale): String {
            val f = RelativeDateTimeFormatter.getInstance(ULocale.forLocale(locale), null, RelativeDateTimeFormatter.Style.LONG, DisplayContext.CAPITALIZATION_NONE)
            val u = when (unit) {
                "year" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.YEAR
                "month" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.MONTH
                "week" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.WEEK
                "day" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.DAY
                "hour" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.HOUR
                "minute" -> RelativeDateTimeFormatter.RelativeDateTimeUnit.MINUTE
                else -> RelativeDateTimeFormatter.RelativeDateTimeUnit.SECOND
            }
            return f.format(value, u)
        }

        override fun compact(n: Double, locale: Locale): String =
            NumberFormatter.withLocale(locale).notation(Notation.compactShort()).precision(Precision.maxFraction(1))
                .roundingMode(java.math.RoundingMode.HALF_UP).format(n).toString()

        override fun percent(fraction: Double, locale: Locale): String =
            NumberFormatter.withLocale(locale).unit(MeasureUnit.PERCENT).scale(com.ibm.icu.number.Scale.powerOfTen(2))
                .precision(Precision.maxFraction(0)).roundingMode(java.math.RoundingMode.HALF_UP).format(fraction).toString()

        override fun unitNarrow(value: Double, unit: String, locale: Locale): String {
            val u = when (unit) {
                "hour" -> MeasureUnit.HOUR
                "minute" -> MeasureUnit.MINUTE
                else -> MeasureUnit.SECOND
            }
            return NumberFormatter.withLocale(locale).unit(u).unitWidth(NumberFormatter.UnitWidth.NARROW)
                .roundingMode(java.math.RoundingMode.HALF_UP).format(value).toString()
        }
    }

    companion object {
        @BeforeClass
        @JvmStatic
        fun setUp() {
            Vectors.useAssets()
            TimeFormat.icu = Icu4j
        }
    }

    private fun JsonObject.s(k: String): String? = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull

    private val generated get() = Vectors["generated"].jsonObject
    private val now get() = generated["now"]!!.jsonPrimitive.long
    private val zone get() = TimeZone.getTimeZone(generated.s("zone"))

    private fun locale(tag: String) = Locale.forLanguageTag(tag)

    @Test
    fun stamps() {
        val cases = Vectors["stamps"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("formatStamp", cases) { c ->
            val node = Node.Timestamp(c["unix"]!!.jsonPrimitive.double, c.s("style")!![0])
            val got = Timestamps.text(node, now, locale(c.s("locale")!!), zone)
            if (got == c.s("out")) null else "${c.s("locale")} ${node.unix} ${node.style}: web ${Vectors.show(c.s("out")!!)} kotlin ${Vectors.show(got)}"
        }
    }

    @Test
    fun dates() {
        val cases = Vectors["dates"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("time.ts", cases) { c ->
            val loc = locale(c.s("locale")!!)
            val diffs = ArrayList<String>()
            fun check(name: String, want: String?, got: String) {
                if (want != got) diffs += "$name web ${want?.let { Vectors.show(it) }} kotlin ${Vectors.show(got)}"
            }
            when {
                c.containsKey("bytes") -> check("bytes", c.s("out"), TimeFormat.formatBytes(c["bytes"]!!.jsonPrimitive.double, Vectors.trValues))
                c.containsKey("timestamp") -> {
                    val ms = c["ms"]!!.jsonPrimitive.long
                    check("timestamp", c.s("timestamp"), TimeFormat.formatTimestamp(ms, now, loc, Vectors.trValues, zone))
                    check("relative", c.s("relative"), TimeFormat.formatRelative(ms, now, loc, Vectors.trValues, zone))
                }
                c.containsKey("ms") -> {
                    val ms = c["ms"]!!.jsonPrimitive.long
                    check("time", c.s("time"), TimeFormat.formatTime(ms, loc, zone))
                    check("divider", c.s("divider"), TimeFormat.formatDateDivider(ms, loc, zone))
                    check("full", c.s("full"), TimeFormat.formatFull(ms, loc, zone))
                    check("exact", c.s("exact"), TimeFormat.formatExact(ms, loc, zone))
                    check("listWhen", c.s("listWhen"), TimeFormat.formatListWhen(ms, now, loc, zone))
                    check("shortDate", c.s("shortDate"), TimeFormat.formatShortDate(ms, loc, zone))
                    if (TimeFormat.sameDay(ms, now, zone) != c["sameDay"]!!.jsonPrimitive.boolean) diffs += "sameDay"
                }
                c.containsKey("duration") -> {
                    val s = c["duration"]!!.jsonPrimitive.double
                    check("short", c.s("short"), TimeFormat.formatShortDuration(s, loc))
                    check("long", c.s("long"), TimeFormat.formatDuration(s))
                }
                c.containsKey("compact") -> check("compact", c.s("out"), TimeFormat.formatCompact(c["compact"]!!.jsonPrimitive.double, loc))
                c.containsKey("percent") -> check("percent", c.s("out"), TimeFormat.formatPercent(c["percent"]!!.jsonPrimitive.double, loc))
            }
            if (diffs.isEmpty()) null else "$c\n" + diffs.joinToString("\n")
        }
    }

    @Test
    fun relativeTicks() {
        assertEquals(10_000L, Timestamps.relativeTick(-59_000))
        assertEquals(30_000L, Timestamps.relativeTick(60_000))
        assertEquals(60_000L, Timestamps.relativeTick(3_600_000))
        assertEquals(3_600_000L, Timestamps.relativeTick(86_400_000))
        assertEquals("10000000000000000000", Timestamps.text(Node.Timestamp(9999999999999999999.0, 'T'), now, Locale.ENGLISH, zone))
    }
}
