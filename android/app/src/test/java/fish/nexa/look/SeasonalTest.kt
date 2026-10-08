package fish.nexa.look

import fish.nexa.ui.theme.look.Seasonal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** The seasons as lib/look/seasonal.test.ts has them. */
class SeasonalTest {
    private fun ids(on: LocalDate) = Seasonal.on(on).map { it.id }

    @Test
    fun offersEachInItsSeasonOnly() {
        assertEquals(listOf("season-halloween", "season-fall"), ids(LocalDate.of(2026, 10, 8)))
        assertEquals(listOf("season-halloween", "season-fall"), ids(LocalDate.of(2026, 11, 2)))
        assertEquals(listOf("season-fall"), ids(LocalDate.of(2026, 11, 3)))
        assertEquals(listOf("season-summer", "season-summer-night"), ids(LocalDate.of(2026, 7, 4)))
        assertEquals(listOf("season-valentines", "season-winter", "season-winter-night"), ids(LocalDate.of(2027, 2, 14)))
    }

    @Test
    fun givesEachLightOneANightVersionAndSnowOnlyToWinterNight() {
        for (s in Seasonal.ALL.filter { it.scheme == "light" }) {
            val night = Seasonal.byId("${s.id}-night")!!
            assertEquals("dark", night.scheme)
            assertEquals(listOf(s.from, s.to, s.art), listOf(night.from, night.to, night.art))
        }
        assertEquals(listOf("season-winter-night"), Seasonal.ALL.filter { it.snow }.map { it.id })
    }

    @Test
    fun showsASeasonAndItsNightVersionAsOneCard() {
        val cards = Seasonal.cards(Seasonal.ALL).map { it.light.id to it.dark?.id }
        assertEquals(
            listOf("season-halloween" to null, "season-fall" to null, "season-winter" to "season-winter-night", "season-holidays" to null, "season-valentines" to null, "season-spring" to "season-spring-night", "season-summer" to "season-summer-night"),
            cards,
        )
    }

    @Test
    fun carriesASeasonAcrossTheNewYear() {
        val winter = Seasonal.byId("season-winter")!!
        val holidays = Seasonal.byId("season-holidays")!!
        assertTrue(Seasonal.inSeason(winter, LocalDate.of(2026, 12, 31)))
        assertTrue(Seasonal.inSeason(winter, LocalDate.of(2027, 1, 15)))
        assertFalse(Seasonal.inSeason(winter, LocalDate.of(2027, 3, 1)))
        assertTrue(Seasonal.inSeason(holidays, LocalDate.of(2027, 1, 6)))
        assertFalse(Seasonal.inSeason(holidays, LocalDate.of(2027, 1, 7)))
        assertEquals(LocalDate.of(2027, 1, 6), Seasonal.end(holidays, LocalDate.of(2026, 12, 20)))
        assertEquals(LocalDate.of(2027, 2, 28), Seasonal.end(winter, LocalDate.of(2026, 12, 5)))
        assertEquals(LocalDate.of(2028, 2, 29), Seasonal.end(winter, LocalDate.of(2027, 12, 5)))
    }

    @Test
    fun alwaysHasSomethingInSeason() {
        var d = LocalDate.of(2027, 1, 1)
        while (d.year == 2027) {
            assertTrue(d.toString(), Seasonal.on(d).isNotEmpty())
            d = d.plusDays(1)
        }
    }

    @Test
    fun goesBackToTheDefaultOnceTheSeasonIsOver() {
        assertEquals("season-halloween", Seasonal.orDefault("season-halloween", LocalDate.of(2026, 10, 31)))
        assertEquals("dark", Seasonal.orDefault("season-halloween", LocalDate.of(2026, 11, 3)))
        assertEquals("forest", Seasonal.orDefault("forest", LocalDate.of(2026, 11, 3)))
        assertNull(Seasonal.active("season-summer", LocalDate.of(2026, 10, 8)))
    }
}
