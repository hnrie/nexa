package xyz.evilion.chat.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.Session

/**
 * Work that has to finish even though whatever started it is about to vanish.
 *
 * `rememberCoroutineScope()` lives exactly as long as the composable that asked
 * for it, and almost every action in a bottom sheet closes the sheet in the same
 * breath as it starts its work:
 *
 * ```
 * scope.launch { MessageService.delete(channelId, id) }
 * onDismiss()                                    // and the scope dies here
 * ```
 *
 * Whether the delete happened came down to how far the coroutine got before the
 * recomposition cancelled it — on the emulator it printed "rememberCoroutineScope
 * left the composition" and deleted the message anyway; on a slow connection it
 * would just quietly not delete it. Pinning, reacting, marking unread and
 * leaving a server all had the same shape.
 *
 * So the ones that change something on the server run here instead, on a scope
 * that belongs to the session rather than to a sheet. Anything that only touches
 * this composable's own state — animating a sheet closed, scrolling a list —
 * should keep using `rememberCoroutineScope`, which is what cancellation is for.
 */
fun detached(block: suspend CoroutineScope.() -> Unit): Job = Session.scope.launch(block = block)

/**
 * The same, for work whose result the composable still wants if it is around to
 * see it: `detachedAsync { send() }` runs on the session, and a
 * `rememberCoroutineScope` coroutine can `await()` it to tidy up afterwards. If
 * that one is cancelled the tidying is skipped and the send still happens, which
 * is the right way round.
 */
fun <T> detachedAsync(block: suspend CoroutineScope.() -> T): Deferred<T> = Session.scope.async(block = block)
