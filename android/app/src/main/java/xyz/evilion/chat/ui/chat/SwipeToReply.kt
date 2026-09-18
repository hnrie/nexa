package xyz.evilion.chat.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import xyz.evilion.chat.ui.theme.chatColors
import kotlin.math.roundToInt

/** How far a message has to be dragged before letting go replies to it. */
private val TRIGGER = 64.dp
/** Past the trigger the row barely moves, so the gesture has an end to it. */
private val LIMIT = 92.dp

/**
 * The strip down the left that belongs to the drawer, not to this.
 *
 * Both gestures are a rightward drag, and this one is on every row of the
 * list, so it took all of them: opening the channel list by swiping in from
 * the edge — the thing you do far more often than replying, and the only way
 * to get there one-handed — simply stopped working. A drag that starts in
 * here is left alone and never consumed, so it reaches the drawer.
 */
private val DRAWER_EDGE = 40.dp

/**
 * Drag a message to the right to reply to it, the way every phone chat app
 * does. An arrow follows the row out and fills in as the gesture gets close;
 * at the point it would fire the phone buzzes once, so it can be felt without
 * looking, and letting go there opens the reply. Letting go short of it, or
 * dragging back, springs the row home and does nothing.
 *
 * Only horizontal drags are taken: the list still scrolls through this.
 */
@Composable
fun SwipeToReply(enabled: Boolean, onReply: () -> Unit, content: @Composable () -> Unit) {
    if (!enabled) {
        content()
        return
    }
    val colors = chatColors
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val trigger = with(density) { TRIGGER.toPx() }
    val limit = with(density) { LIMIT.toPx() }
    val edge = with(density) { DRAWER_EDGE.toPx() }
    /** This drag began in the drawer's strip, so it is none of our business. */
    var yielded by remember { mutableStateOf(false) }
    var buzzed by remember { mutableStateOf(false) }
    val progress = (offset.value / trigger).coerceIn(0f, 1f)

    Box(Modifier.fillMaxWidth()) {
        if (offset.value > 1f) {
            Box(Modifier.fillMaxHeight().padding(start = 14.dp), contentAlignment = Alignment.CenterStart) {
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
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .pointerInput(onReply) {
                    detectHorizontalDragGestures(
                        onDragStart = { start -> yielded = start.x <= edge },
                        onDragEnd = {
                            val fire = !yielded && offset.value >= trigger
                            buzzed = false
                            yielded = false
                            scope.launch {
                                offset.animateTo(0f)
                                if (fire) onReply()
                            }
                        },
                        onDragCancel = {
                            buzzed = false
                            yielded = false
                            scope.launch { offset.animateTo(0f) }
                        },
                    ) { change, drag ->
                        // Not consumed and not acted on: the drawer is watching
                        // the same pointer and takes it from here.
                        if (yielded) return@detectHorizontalDragGestures
                        change.consume()
                        // rightwards only, and heavier the further it goes
                        val next = (offset.value + if (offset.value > trigger) drag * 0.35f else drag)
                        val clamped = next.coerceIn(0f, limit)
                        if (clamped >= trigger && !buzzed) {
                            buzzed = true
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        } else if (clamped < trigger) {
                            buzzed = false
                        }
                        scope.launch { offset.snapTo(clamped) }
                    }
                },
        ) {
            content()
        }
    }
}
