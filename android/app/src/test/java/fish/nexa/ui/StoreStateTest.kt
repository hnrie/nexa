package fish.nexa.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class StoreStateTest {
    @Test fun ignoresOtherEntriesButPublishesUpdatesRemovalAndReset() = runTest {
        val store = MutableStateFlow<Map<String, String>>(mapOf("open" to "a"))
        val seen = mutableListOf<String?>()
        val job = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { store.entryFlow("open").collect { seen += it } }
        store.value = store.value + ("other" to "busy")
        store.value = store.value + ("open" to "b")
        store.value = store.value - "open"
        store.value = mapOf("open" to "new account")
        store.value = emptyMap()
        assertEquals(listOf("a", "b", null, "new account", null), seen)
        job.cancel()
    }

    @Test fun missingAndNullKeysStayEmptyUntilTheRequestedEntryArrives() = runTest {
        val store = MutableStateFlow<Map<String, Int>>(emptyMap())
        val seen = mutableListOf<Int?>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { store.entryFlow("wanted").collect { seen += it } }
        val none = mutableListOf<Int?>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { store.entryFlow(null).collect { none += it } }
        store.value = mapOf("other" to 1)
        store.value = store.value + ("wanted" to 2)
        assertEquals(listOf(null, 2), seen)
        assertEquals(listOf<Int?>(null), none)
    }
}
