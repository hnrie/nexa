package xyz.evilion.chat.ui.sheets

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Closing a bottom sheet the way Material means it to be closed.
 *
 * A sheet's layer is state: taking it out of the list takes the sheet out of
 * the composition on the same frame, so every sheet in the app slid in
 * normally and then simply ceased to exist — no slide down, no scrim fade.
 * That asymmetry is most of what "the UI is scuffed" means. This runs the
 * component's own hide animation first and removes the layer when it ends.
 *
 * Pass the result as `onDismissRequest`, and call it from any close button the
 * sheet draws itself, so both routes out look the same.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun rememberSheetDismiss(state: SheetState, onDone: () -> Unit): () -> Unit {
    val scope = rememberCoroutineScope()
    return remember(state, onDone) {
        {
            scope.launch { state.hide() }.invokeOnCompletion {
                // a hide that was interrupted — the sheet was dragged back up —
                // leaves the layer alone
                if (!state.isVisible) onDone()
            }
        }
    }
}

/**
 * How tall a list-shaped bottom sheet should be.
 *
 * These were a flat 520 dp. On a short phone, in landscape, or at a large font
 * scale that is taller than the window, and the content at the foot of the
 * sheet — the button that finishes whatever it is for — was simply cut off with
 * nothing to scroll. A fraction of the window with the old value as a ceiling
 * keeps the shape everywhere.
 */
@Composable
fun sheetHeight(fraction: Float = 0.72f, max: Dp = 520.dp): Dp {
    val window = LocalConfiguration.current.screenHeightDp.dp
    return (window * fraction).coerceAtMost(max)
}
