package xyz.evilion.chat.i18n

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The language choice has to land on the same tag the web client would, or one
 * account reads differently on a phone than in a browser.
 */
class PickTest {
    @Test
    fun `an exact tag wins`() {
        assertEquals("pt-BR", Strings.pick(listOf("pt-BR")))
        assertEquals("zh-CN", Strings.pick(listOf("zh-cn")))
    }

    @Test
    fun `a base language finds its region`() {
        assertEquals("pt-BR", Strings.pick(listOf("pt-PT")))
        assertEquals("pt-BR", Strings.pick(listOf("pt")))
        assertEquals("zh-CN", Strings.pick(listOf("zh-Hans")))
    }

    @Test
    fun `the first preference that is shipped wins`() {
        assertEquals("de", Strings.pick(listOf("nl", "de", "fr")))
        assertEquals("fr", Strings.pick(listOf("", "  ", "fr")))
    }

    @Test
    fun `anything unknown falls back to English`() {
        assertEquals("en", Strings.pick(listOf("cy", "eo")))
        assertEquals("en", Strings.pick(emptyList()))
    }

    @Test
    fun `every shipped language is picked by its own tag`() {
        for (l in LANGUAGES) assertEquals(l.tag, Strings.pick(listOf(l.tag)))
    }
}
