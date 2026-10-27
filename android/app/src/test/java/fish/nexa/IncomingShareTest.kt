package fish.nexa

import fish.nexa.ui.share.Share
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingShareTest {
    @Test fun anotherAppCannotAskNexaToShareItsOwnFiles() {
        assertFalse(Share.acceptsUri("file", null, "fish.nexa"))
        assertFalse(Share.acceptsUri("content", "fish.nexa.files", "fish.nexa"))
        assertFalse(Share.acceptsUri("content", "0@fish.nexa.files", "fish.nexa"))
        assertFalse(Share.acceptsUri("content", "10@fish.nexa.files", "fish.nexa"))
        assertFalse(Share.acceptsUri("content", "fish.nexa.debug.files", "fish.nexa.debug"))
        assertFalse(Share.acceptsUri("https", "example.com", "fish.nexa"))
        assertFalse(Share.acceptsUri("content", "", "fish.nexa"))
        assertFalse(Share.acceptsUri("content", "0@", "fish.nexa"))
        assertTrue(Share.acceptsUri("content", "com.android.providers.media.documents", "fish.nexa"))
        assertTrue(Share.acceptsUri("content", "10@com.android.providers.media.documents", "fish.nexa"))
    }
}
