package fish.nexa

import fish.nexa.ui.settings.DataExport
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportPrivacyTest {
    @Test fun settingsExportOmitsThePasscodePolicy() {
        val settings = buildJsonObject {
            put("theme", "dark")
            put("appLock", buildJsonObject { put("verifier", "private-verifier"); put("salt", "private-salt") })
        }
        val exported = DataExport.publicSettings(settings)
        assertFalse(exported.containsKey("appLock"))
        assertEquals(settings["theme"], exported["theme"])
        assertTrue(settings.containsKey("appLock"))
    }
}
