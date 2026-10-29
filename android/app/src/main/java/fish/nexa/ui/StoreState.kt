package fish.nexa.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.key as compositionKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** Observe one immutable store entry, so unrelated gateway events do not redraw every row. */
fun <K, V> StateFlow<Map<K, V>>.entryFlow(key: K?): Flow<V?> =
    map { entries -> key?.let { entries[it] } }.distinctUntilChanged()

@Composable
fun <K, V> StateFlow<Map<K, V>>.collectEntryAsState(key: K?): State<V?> {
    return compositionKey(this, key) {
        val entry = remember(this, key) { entryFlow(key) }
        entry.collectAsState(initial = key?.let { value[it] })
    }
}
