package fish.nexa.data

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class NameStyleTest {
    @Test fun motionChoiceSurvivesProfileRoundTripAndEffectChanges() {
        for (animated in listOf(false, true)) {
            val style = NameStyle("comic", "gradient", listOf(0xff0000, 0x0000ff), animated)
            val read = NameStyle.read(style.toJson())!!
            assertEquals(style, read)
            assertEquals(animated, NameStyle.withEffect(read, "holo").isAnimated)
        }
    }

    @Test fun missingAndMalformedChoicesKeepLegacyMotion() {
        assertFalse(NameStyle("", "gradient", listOf(1, 2)).isAnimated)
        assertTrue(NameStyle("", "aurora", listOf(1, 2)).isAnimated)
        val style = NameStyle.read(Json.parseToJsonElement("""{"effect":"gradient","colors":[1,2],"animated":"true"}"""))!!
        assertNull(style.animated)
        assertFalse(style.isAnimated)
    }
}
