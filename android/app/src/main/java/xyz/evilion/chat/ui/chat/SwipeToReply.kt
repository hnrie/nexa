package xyz.evilion.chat.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.theme.chatColors
import kotlin.math.abs
import kotlin.math.roundToInt

/** How far a message has to be dragged before letting go replies to it. */
private val TRIGGER = 64.dp
/** Past the trigger the row barely moves, so the gesture has an end to it. */
private val LIMIT = 92.dp

/**
 * Drag a message toward the start edge — to the left, or to the right in a
 * right-to-left language — to reply to it, as Discord does. An arrow comes out
 * from under the row at the far side and fills in as the gesture gets close; at
 * the point it would fire the phone buzzes once, so it can be felt without
 * looking, and letting go there opens the reply. Letting go short of it, or
 * dragging back, springs the row home and does nothing.
 *
 * It used to be a drag the other way, which is the drawer's: the channel list
 * opens with a rightward swipe from anywhere on the conversation, as it does in
 * the web client, and every row of the list took that swipe for a reply. A
 * strip down the edge was set aside for the drawer, but it never reached it —
 * the library's detector claims a drag, and consumes it, before anyone is asked
 * whose it is — and with gesture navigation that edge belongs to the system's
 * Back anyway.
 *
 * So only a drag in the reply direction is claimed. One going the other way is
 * let go untouched and the drawer takes it; a vertical one is the list's.
 */
@Composable
fun SwipeToReply(enabled: Boolean, onReply: () -> Unit, content: @Composable () -> Unit) {
    if (!enabled) {
        content()
        return
    }
    val colors = chatColors
    val density = LocalDensity.current
    // Which way on screen is "toward the start": -1 is left.
    val toStart = if (LocalLayoutDirection.current == LayoutDirection.Rtl) 1f else -1f
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val reply by rememberUpdatedState(onReply)
    /** How far the row has travelled toward the start edge. Never negative. */
    val offset = remember { Animatable(0f) }
    val trigger = with(density) { TRIGGER.toPx() }
    val limit = with(density) { LIMIT.toPx() }
    val progress = (offset.value / trigger).coerceIn(0f, 1f)

    Box(Modifier.fillMaxWidth()) {
        if (offset.value > 1f) {
            Box(
                Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(end = 16.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(
                    Lucide.Reply,
                    t("chat.messageItem.reply"),
                    tint = if (progress >= 1f) colors.brand else colors.textMuted,
                    modifier = Modifier.size(20.dp).alpha(progress).scale(0.7f + 0.3f * progress),
                )
            }
        }
        Box(
            Modifier
                .offset { IntOffset((offset.value * toStart).roundToInt(), 0) }
                .pointerInput(toStart) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val slop = viewConfiguration.touchSlop
                        var dx = 0f
                        var dy = 0f
                        var claimed = false
                        var travelled = 0f
                        var buzzed = false
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) break
                            val moved = change.positionChange()
                            if (!claimed) {
                                // somebody deeper in took it: a slider, a scroller
                                if (change.isConsumed) break
                                dx += moved.x
                                dy += moved.y
                                if (abs(dx) <= slop && abs(dy) <= slop) continue
                                // a scroll, or a drag toward the end edge: not ours
                                if (abs(dx) < abs(dy) * 1.3f || dx * toStart <= 0f) break
                                claimed = true
                                change.consume()
                                continue
                            }
                            change.consume()
                            val step = moved.x * toStart
                            // heavier past the trigger, so the gesture has an end to it
                            travelled = (travelled + if (travelled > trigger) step * 0.35f else step).coerceIn(0f, limit)
                            if (travelled >= trigger && !buzzed) {
                                buzzed = true
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            } else if (travelled < trigger) {
                                buzzed = false
                            }
                            val to = travelled
                            scope.launch { offset.snapTo(to) }
                        }
                        if (claimed) {
                            val fire = travelled >= trigger
                            scope.launch {
                                offset.animateTo(0f)
                                if (fire) reply()
                            }
                        }
                    }
                },
        ) {
            content()
        }
    }
}
