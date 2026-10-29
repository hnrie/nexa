package fish.nexa.data

import fish.nexa.ui.nav.Route
import org.junit.Assert.assertEquals
import org.junit.Test

class ReportsRouteTest {
    @Test fun reportsKeepTheirStaffTabAndDetailId() {
        assertEquals("reports", Route.Admin("reports").tab)
        val detail = Route.Admin("reports/123")
        assertEquals("reports", detail.tab)
        assertEquals("123", detail.parts[1])
        assertEquals("/channels/@admin/reports/123", detail.toPath())
    }
}
