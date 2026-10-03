package fish.nexa.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlin.math.abs

/** How far a row follows the finger before it lets go to reply, and the most it moves. */
const val REPLY_AT_DP = 56f
private const val REPLY_MAX_DP = 84f

/** lib/longPress.ts: a finger held still this long opens the message's menu. */
const val LONG_PRESS_MS = 450L

class RowSwipe {
    val offset = Animatable(0f)
}

@Composable
fun rememberRowSwipe() = remember { RowSwipe() }

/**
 * The touch life of a message row, watched before anything inside it sees the
 * finger: held still for 450 ms it opens the menu (and the release that ends
 * it reaches nothing else); dragged against the reading direction (leftward
 * in English) it follows the finger and, past the line, replies. Vertical
 * drags go to the list, the other way to the page's drawer.
 */
@Composable
fun Modifier.rowTouch(
    enabled: Boolean,
    canReply: Boolean,
    swipe: RowSwipe,
    onLongPress: () -> Unit,
    onReply: () -> Unit,
): Modifier {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val reduced = Nx.motion.reduced
    val ease = Nx.motion.easeOut
    val longPress by rememberUpdatedState(onLongPress)
    val reply by rememberUpdatedState(onReply)
    if (!enabled) return this
    return this.pointerInput(canReply, rtl) {
        val slop = 12f * density
        val replyAt = REPLY_AT_DP * density
        val max = REPLY_MAX_DP * density
        // toward the end of the reading direction: left in English, right in Arabic
        val dir = if (rtl) 1f else -1f
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val downAt = System.currentTimeMillis()
            TouchClaims.onMessageRow = true
            var total = Offset.Zero
            // 0 undecided, 1 swiping to reply, 2 someone else's (scroll, drawer), 3 held for the menu
            var mode = 0
            var armed = false
            try {
                while (true) {
                    val ev = if (mode == 0) {
                        val left = LONG_PRESS_MS - (System.currentTimeMillis() - downAt)
                        withTimeoutOrNull(maxOf(1L, left)) { awaitPointerEvent(PointerEventPass.Initial) }
                    } else awaitPointerEvent(PointerEventPass.Initial)
                    if (ev == null) {
                        mode = 3
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        longPress()
                        continue
                    }
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    if (!ch.pressed) {
                        if (mode == 3) ch.consume()
                        break
                    }
                    if (mode == 3) {
                        ch.consume()
                        continue
                    }
                    total += ch.positionChange()
                    if (mode == 0 && (abs(total.x) >= slop || abs(total.y) >= slop)) {
                        val sideways = abs(total.x) > 1.3f * abs(total.y)
                        mode = if (canReply && sideways && total.x * dir > 0 && !ch.isConsumed) 1 else 2
                        if (mode == 2) return@awaitEachGesture
                    }
                    if (mode == 1) {
                        ch.consume()
                        val pulled = (total.x * dir).coerceAtLeast(0f)
                        // follows the finger, then drags behind it past the line
                        val shown = if (pulled <= replyAt) pulled else replyAt + (pulled - replyAt) * 0.35f
                        scope.launch { swipe.offset.snapTo(dir * shown.coerceAtMost(max)) }
                        if (!armed && pulled >= replyAt) {
                            armed = true
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        } else if (armed && pulled < replyAt) armed = false
                    }
                }
            } finally {
                TouchClaims.onMessageRow = false
                if (mode == 1) {
                    if (armed) reply()
                    scope.launch { swipe.offset.animateTo(0f, tween(if (reduced) 0 else 220, easing = ease)) }
                }
            }
        }
    }
}
