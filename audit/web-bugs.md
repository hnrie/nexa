# Web client bugs

Scope: `web/src` at working tree `main` (HEAD `47e5bb5`) — every store, the
gateway session and dispatcher, the HTTP client, `lib/`, the crypto *usage*,
`markdown/`, `voice/`, the service workers, and the React tree under
`components/` and `pages/`. Roughly 46,000 lines of TypeScript and TSX.

Baseline before reading anything: `npx tsc --noEmit -p tsconfig.json` exits 0,
and `npx vitest run` passes 842 tests across 89 files. Nothing was already
failing, and nothing here was changed.

## Summary

The infrastructure is unusually careful for a codebase this size. The message
store has a generation counter that kills stale pages, the settings store keeps
`dirty`/`sending` sets so a save that crosses another device's keeps both
halves, the gateway counts frames rather than timestamps to decide a heartbeat
was answered, the markdown parser caps depth and source length and memoises
failed closer searches (measured: the worst hostile input I could build costs
14 ms against 1.3 ms for ordinary prose — bounded, not quadratic), and the
service worker deliberately has no fetch handler. Most of the obvious classes of
bug the brief asks about have already been thought about and defended against
somewhere.

What is left falls into four groups.

**Promises nobody catches.** Three `void f()` calls in the gateway path have no
`.catch`. The worst is `syncGap`, the function whose entire job is to fill in
what arrived while the socket was down: one failed request after a reconnect and
the open conversation silently misses every message from the outage, with no
spinner, no error and no retry.

**One flag with two owners.** `ui.focused` is written both by `ThemeEffect` from
`document.hasFocus()` and by `DesktopEffects` from the desktop app's real window
state. `document.hasFocus()` is known to lie inside Electron — the repo's own
comments say so — and `ui.focused` is what decides whether an incoming message
is silently marked read.

**Read state drifting.** Three independent paths mark things read that the
reader never saw: the dispatcher acks any message arriving in the active channel
regardless of where the reader is scrolled (contradicting `MessageList`'s own
much more careful rule twenty lines away), Escape acks the newest *loaded*
message even when the list stops short of the present, and a deleted mention
decrements `unread` but never `mentions`, so the red pill sticks.

**Untranslated strings.** The app ships eleven languages and routes essentially
everything through `t()`, which makes the exceptions stand out: the connection
banner, the search panel's result count, `<t:…>` timestamps (which also use the
*browser's* locale rather than the app's, the exact thing `lib/time.ts` was
written to avoid), slowmode labels and the Rich Presence card.

Counts: **3 DATA-LOSS**, **8 BROKEN**, **12 RACE**, **11 LEAK**, **33 BAD**,
**17 POLISH** — 84 findings.

## Findings

### [DATA-LOSS] `retryPending` deletes the failed message before it knows the retry will run

- **Where**: `web/src/components/composer/send.ts:133`
- **What**: `store.removePending(channelId, tmpId)` runs *before* `await sendMessage(...)`. `sendMessage` has two silent early returns — `if (!me) return;` (`send.ts:39`) and `if (!payload.t && !payload.att && !payload.sticker) return;` (`send.ts:46`) — neither of which adds a replacement pending row or throws. On either path the message the user wrote is gone from the store with no toast, no row and nothing to retry.
- **Repro**: A message fails to send (offline). The session is torn down and re-bootstrapped so `useAuth.getState().me` is momentarily null (`stores/auth.ts:136` sets `me: null` on a 401). Click **Retry** on the failed bubble (`MessageItem.tsx:217`). The bubble vanishes and the text is unrecoverable.
- **Fix**: Only `removePending` once `sendMessage` has created its own pending entry, or have `sendMessage` return a discriminated result and re-add the original pending on a no-op return.

### [DATA-LOSS] Channel settings never resync, so saving reverts a concurrent rename

- **Where**: `web/src/components/server/ChannelSettingsModal.tsx:57-70`
- **What**: `OverviewPage` seeds `name`, `topic`, `slow`, `nsfw` and `limit` from `channel` with `useState` and never resyncs them when the channel changes underneath. `dirty` is computed as `name !== channel.name || …`, so a change made by *someone else* makes the form look dirty with the reader's stale values in it.
- **Repro**: Open a channel's settings and change nothing. Another moderator renames the channel; the `channel_update` event lands and `channel.name` changes. The "Careful — you have unsaved changes" bar appears on your screen with no edit from you. Press **Save Changes** and the PATCH sends the *old* name, silently undoing their rename.
- **Fix**: Key the page on the channel's `updated_at`, or hold a `base` snapshot in state and re-seed from `channel` whenever it changes while `dirty` is false.

### [DATA-LOSS] A cross-device settings merge replaces `notifications.perChannel` and `muted` wholesale

- **Where**: `web/src/stores/settings.ts:139` (`mergeSettings`) and `:179` (`mergeChanges`)
- **What**: Both merges are one level deep: `notifications: { ...base.notifications, ...(inc.notifications ?? {}) }`. `perChannel` and `muted` are objects/arrays *inside* `notifications`, so whichever side supplies a `notifications` key replaces both of them entirely. `load()` (`:267`) lays this device's unsaved changes over the server's copy with exactly that merge.
- **Repro**: Device A mutes channel X. Device B, with an unsaved mute of channel Y still in `dirty` (offline, or inside the 800 ms debounce), receives A's blob. `load` merges B's `{notifications: {muted: [...Y]}}` over it, so X's mute is dropped. B then saves that, and X is unmuted everywhere.
- **Fix**: Merge `perChannel` per key and union `muted`, or give the two their own top-level slots so the shallow merge is correct.

### [BROKEN] A failed `syncGap` silently loses every message that arrived during an outage

- **Where**: `web/src/gateway/dispatch.ts:128`, `web/src/stores/messages.ts:308-368`
- **What**: `syncGap` is the only thing that fills the hole a disconnect leaves in the channel being read (`ready` keeps that channel's messages precisely so the reader is not thrown to the bottom — `dispatch.ts:107`). It contains no `try`/`catch` at all, and the caller is a bare `void useMessages.getState().syncGap(active)`. Any failure in the five `messagesApi.list` calls, in `decryptForStore`, or in the ten refresh pages rejects the promise and abandons the walk part-way. Nothing retries, `loading` was never set so no spinner is stuck, and the reader sees nothing.
- **Repro**: Read a channel. Lose the network for a minute (twenty messages arrive). Come back; the gateway reconnects and `ready` fires. The very first `GET /channels/:id/messages?after=…` fails — flaky Wi-Fi is the common case, and this fires at the exact moment the connection just came back. The channel shows the messages from before the outage, then the ones from after the failure point, with a silent hole in between. Switching channels and back fixes it, because `clearAll` dropped every other channel and this one reloads.
- **Fix**: Wrap the body in `try`/`catch`; on failure `clearChannel` + `loadInitial`, which is already the fallback used when the gap is too wide (`messages.ts:332-335`). `installCrashReporting` will currently report this as an unhandled rejection, which is how you can confirm it happens in the wild.

### [BROKEN] `api.upload` hangs forever when a 2xx response body is not JSON

- **Where**: `web/src/api/client.ts:216`
- **What**: `resolve(JSON.parse(text) as T)` runs inside `finish(...)`, which is called from `xhr.onload` — an event handler, not the promise executor's synchronous body. A `SyntaxError` there propagates to the global error handler; nothing rejects. Worse, `finish` has already set `settled = true` (`:192`), so no later event can settle it either. The returned promise never resolves and never rejects.
- **Repro**: Change your avatar (`api/users.ts:26` → `api.upload`) while a proxy, captive portal or Cloudflare interstitial answers `200` with an HTML body. The spinner on the avatar button spins forever and the modal can never be saved or closed cleanly. The same path covers server icons (`api/servers.ts:45`), channel icons (`api/channels.ts:35`), emoji and sticker uploads (`api/expressions.ts:9`), and attachment pieces whenever the upload worker is unavailable (`lib/attachments.ts:101`, `:112`).
- **Fix**: Wrap the parse: `try { resolve(JSON.parse(text)) } catch { reject(new ApiError(xhr.status, "bad_response", …)) }` — exactly what the worker path already does at `lib/attachments.ts:129-134`.

### [BROKEN] `ServerPage`'s `seen` ref is never reset, so opening a not-yet-loaded server bounces you home

- **Where**: `web/src/pages/ServerPage.tsx:28` (declaration), `:39` (the read)
- **What**: `seen` is a `useRef(false)` set to `true` the first time any server's state is present. All three server routes render the same `<ServerPage />` element (`routes.tsx:42-44`), so navigating from server A to server B does not remount — `seen.current` is still `true`. If B is not yet in the store the effect takes `if (seen.current) { setMissing(true); return; }` and never even tries `serversApi.get(serverId)`; the effect at `:87` then navigates to `/channels/@me`.
- **Repro**: Sit in server A. Follow a link or a notification to server B before the gateway's payload for B has landed. You are silently returned to the friends page instead of B opening.
- **Fix**: Reset `seen.current = false` and `setMissing(false)` whenever `serverId` changes, or key the component on `serverId`.

### [BROKEN] A failed lock check leaves a subchat permanently showing the password wall

- **Where**: `web/src/components/chat/ChatView.tsx:142`
- **What**: `lockState(channel.id).then(...).catch(() => {})` swallows the error and leaves `unlocked === false`, so `locked` (`ChatView.tsx:147`) stays true and `<LockedChannel>` renders forever. No error, no retry, no way past except typing a password the user may already have entered this session — the server-side `unlocked` flag would have said so.
- **Repro**: Open a password-protected subchat you already unlocked this sign-in while `GET /channels/:id/lock` is failing (offline, or a 500). You get the password wall with no explanation; reloading is the only way out.
- **Fix**: Keep the failure in state and render a "couldn't check — retry" affordance instead of the password form; retry on `online`.

### [BROKEN] A 401 never signs anyone out — `api.onUnauthorized` is declared and never assigned

- **Where**: `web/src/api/client.ts:115`, read at `:164`, `:219` and `lib/attachments.ts:136`
- **What**: `onUnauthorized: null as (() => void) | null` is the hook every 401 path calls, and nothing in `web/src` ever writes to it. Grep confirms four readers and zero writers. The app's only route out of an invalid token is the gateway's 4001 close (`gateway/client.ts:126`), which needs a live socket that the server actively closes.
- **Repro**: On device A, Settings → Devices → **Log out all other devices**. Device B is a tab whose socket is up but which the server does not close (or which is mid-backoff, or offline). Every write on B now 401s. B shows red toasts for every action, keeps rendering the cached conversation, and never reaches the login screen. Reloading is the only fix.
- **Fix**: Assign `api.onUnauthorized = () => void useAuth.getState().logout()` wherever the client is configured, and debounce it so a burst of 401s logs out once.

### [BROKEN] `wake()` cannot rescue a socket stuck in `connecting`

- **Where**: `web/src/gateway/client.ts:160-171`, guard at `:166`; `connect()`'s own guard at `:80`
- **What**: `wake()` returns immediately unless the status is `open` (ping) or `closed` with a reconnect timer pending. A socket that is `connecting` and never completes is the third state, and nothing covers it: `connect()` also refuses to act (`if (this._status === "connecting" || this._status === "open") return`). There is no timeout on the handshake — only the *heartbeat* has one, and the heartbeat only starts in `onopen`.
- **Repro**: A phone suspends the tab while the WebSocket is mid-handshake. iOS can leave the socket in `CONNECTING` with no `close` event when the page comes back. Every `online`/`pageshow`/`visibilitychange` then calls `wake()`, which does nothing, and the app sits on "Connecting…" until it is reloaded.
- **Fix**: Start a connect deadline alongside the socket; on expiry, null out `this.ws`, `close()` it and `scheduleReconnect`. Have `wake()` force that when the status is `connecting` and the attempt is older than the deadline.

### [BROKEN] Unplug a headset mid-call and you are silent for the rest of it

- **Where**: `web/src/voice/session.ts:396` (and `:526`)
- **What**: `transport.setLocalAudio(track)` is called with no `track.onended`. Compare the camera at `:576`/`:623`/`:654` and the screen share at `:713`, which all wire `onended` and recover. The only `devicechange` listener in the app is `components/settings/VoicePage.tsx:35`, which is not mounted during a call, and `refreshMic()` (`:511`) runs only from the settings subscription at `:960`.
- **Repro**: Join a call on a USB or Bluetooth headset, then unplug it. Chrome ends the mic track. `LevelMeter` now reads 0, so `startMeter`'s VAD (`:486-491`; `"vad"` is the default mode, `stores/settings.ts:116`) closes the gate and `setAudioGate(false)` replaces the sender's track with null. The mute button still reads "Mute", your tile shows no mute icon, and nobody hears you until you leave and rejoin. Android is not affected: it publishes WebRTC's `AudioDeviceModule` track (`android/…/voice/VoiceSession.kt:154`), which follows the system default device.
- **Fix**: `track.onended = () => void refreshMic()` alongside `setLocalAudio`, plus a `devicechange` listener in `installVoice()` that calls `refreshMic()` when the chosen input disappears.

### [BROKEN] Refused pulls share the failure counter with hard failures, so new speakers stay inaudible for up to eight seconds

- **Where**: `web/src/voice/sfu.ts:830` (and `:302-320`, `:408`)
- **What**: `subscribe()` ends with `if (refused) this.retryLater(false, PULL_RETRY_BASE_MS)`. The comment at `:829` says this is the *expected* case — Cloudflare answers `not_found_track_error` for a publisher that is still connecting, i.e. anyone who joined a second ago. But `retryLater` (`:307-312`) increments the same `this.failures` that real connection failures use, and the delay is `Math.min(RETRY_MAX_MS, baseMs * 2 ** (this.failures - 1))`. `failures` resets only in `onConnectionState` on `"connected"` (`:408`), once per connection, or after the 60 s `FAILURES_FORGOTTEN_MS` gap (`:309`). In a channel where people join or leave more often than once a minute it only climbs.
- **Repro**: Five people join a voice channel a few seconds apart. Each join produces one or two refused pulls, so `failures` reaches 5 or 6. The next person is pulled with a delay of `400 * 2**5` = 6.4 s, then the 8 s cap — they are in the call, their tile says connected, and nobody hears them for eight seconds. The same counter then stretches genuine reconnect retries from 1 s to 8 s.
- **Fix**: Keep a separate counter (or none) for refused-pull retries; only a real `fail()` should feed `this.failures`.

### [BROKEN] `PlayoutDelay` is never told a receiver went away, so after a rebuild the jitter buffer is tuned for a dead receiver

- **Where**: `web/src/voice/sfu.ts:696`, state declared at `:221`
- **What**: `this.playout.observe(s.mid, p.receiver, …)` is the only call site — `PlayoutDelay.forget()` (`playoutDelay.ts:85`) and `.clear()` (`:89`) have zero callers anywhere in the repo. `reset()` (`sfu.ts:374-398`) builds a brand-new `RTCPeerConnection`, whose mids start again at 0, but leaves `this.playout` intact. In `observe`, `if (t.asked) return FLOOR_MS;` (`playoutDelay.ts:78`) short-circuits *before* `apply()`, so the new receiver on the recycled mid never gets `jitterBufferTarget` set.
- **Repro**: Be in an SFU call on a clean link for more than `CLEAN_FOR_MS` (4 s) so mids 0–3 get `jitterBufferTarget = 60`. Drop the network for 25 s and bring it back: `downFor >= TRACKS_GONE_MS` (`:412`) forces a full `rebuild()`. From then on every voice on a recycled mid plays at WebRTC's default buffer — the whole point of the module is silently off for the rest of the call. The map also grows without bound over a long call.
- **Fix**: `this.playout.clear()` in `reset()` and `this.playout.forget(p.mid)` in `unsubscribe()`.

### [BROKEN] `reset()` keeps the repull counter, so a track that bypassed decryption before a rebuild can stay held silent forever

- **Where**: `web/src/voice/sfu.ts:374-398`, counter at `:223`, gate at `:907`, hold at `:894`
- **What**: `reset()` clears `pulled`, `byMid`, `senders` and `published`, but not `repulls`, `lossSeen` or `lossTold`. `checkBypass` filters out any slot with `(this.repulls.get(slot) ?? 0) >= MAX_REPULLS` (`:907`), and `present()` attaches voice with `this.held(userId, "audio")` (`:966`), which stays `true` until the worker reports an opened frame. So the three allowed repulls are spent on the *old* connection and the new one gets none.
- **Repro**: On a Chromium build where packets beat the receiver's transform, a peer's audio bypasses decryption three times (each logged at `:932`). The connection then drops and rebuilds. If the bypass recurs, `checkBypass` refuses to repull, `p.opened` never becomes true, and that person is silent for the remainder of the call while their tile shows "connected".
- **Fix**: Clear `repulls`, `lossSeen` and `lossTold` in `reset()` — they are all per-connection state.

### [BROKEN] A moderator move wipes the frame keys before the new channel's key exists

- **Where**: `web/src/voice/sfu.ts:344`
- **What**: `moveTo()` sets `this.channelId` then immediately calls `refreshKeys()`. At that instant the caller (`session.ts:808-810`) has only just *started* `ensureConvKey(convForChannel(vs.channel_id))` — fired with `void` and never awaited. So `voiceKeysFor()` returns null, `refreshKeys` installs `{ keys: [], send: 0 }`, and the worker's encrypt path hits `const key = keys.get(sendIndex); if (!key) { stats.dropped++; return; }` (`frameCrypto.worker.ts:96-100`) for every frame. Recovery waits for the next `keyTimer` tick, `KEY_CHECK_MS = 4_000` (`:253`).
- **Repro**: Have a moderator drag you from one voice channel to another during a call. For up to four seconds you send nothing and can open nothing, while every tile looks connected.
- **Fix**: Have `ensureConvKey` resolve into a `refreshKeys()` call, or give the key store a `keysArrived()` hook to fire.

### [BROKEN] A guest whose gateway never reaches `ready` spins on "Joining the call…" forever

- **Where**: `web/src/pages/GuestCallPage.tsx:194`
- **What**: `join()` sets `phase = "joining"` and calls `begin()`. `setPhase("call")` happens only inside the gateway's `ready` branch (`:119`). `startGuestSession` routes connection status to `useUI.setConnection` (`gateway/session.ts:70`), which this page never renders — it draws its own tree, not the app shell. There is no timeout and no failure branch, and the "Back to Nexa" escape hatch at `:272` is explicitly hidden while `phase === "joining"`.
- **Repro**: Open a guest link, enter a name, submit, and have the WebSocket fail to establish (server restarting, a proxy dropping `/gateway`, a captive portal). `guestsApi.join` succeeded so no error is shown; the page shows a spinner and "Joining the call…" indefinitely, with nothing clickable.
- **Fix**: Pass an `onStatus` and a timeout through `begin()`; after N seconds without `ready`, set an error and fall back to `phase: "form"`.

### [RACE] `startSession` can build two gateway clients and double-apply every event

- **Where**: `web/src/gateway/session.ts:33` (the `await`) and `:41` (the guard)
- **What**: `startSession` is `async` and awaits `useKeys.getState().init(...)` — which awaits IndexedDB — *before* it reaches `if (client) return`. Two calls that overlap on that await both see `client === null`, both fall through, and the second overwrites `client` with a new `GatewayClient`. The first socket is never closed and never referenced again: it keeps its heartbeat, keeps receiving frames, and keeps calling `applyEvent`. Every message then arrives twice, every `ready` resets the stores twice.
- **Repro**: `RequireAuth` calls `void startSession()` from an effect keyed on `status` (`components/shell/RequireAuth.tsx:22`), and `InvitePage` calls it independently at `:73`. Accept an invite while the session is still starting (a cold load on a slow key store), and both fire within the IndexedDB round trip.
- **Fix**: Set a module-level `starting` flag synchronously at the top of `startSession`, or move the `if (client) return` check above the first `await`.

### [RACE] Events still in the dispatch queue land after `resetAll()` on sign-out

- **Where**: `web/src/gateway/session.ts:47` (the queue) and `:122-125` (`endSession`)
- **What**: `onEvent` chains every event onto one promise: `queue = queue.then(() => applyEvent(e))`. `endSession` calls `stopSession()` and `resetAll()` synchronously and never waits for or cancels that chain. Any `applyEvent` already past its first `await` — `decryptForStore`, `ingestGrants`, `settings.load` — resumes afterwards and writes the old account's data into the freshly cleared stores.
- **Repro**: Sign out while a message with an attachment is being decrypted. The message is inserted into `useMessages` after `clearAll()` ran; the next person to sign in on this tab briefly sees it. Narrow window, but it is the account boundary.
- **Fix**: Bump a generation counter in `stopSession` and have `applyEvent` bail when it changes, the way the messages store's `generations` map already does.

### [RACE] Pagination anchor can be cancelled by a duplicate scroll event, jumping the reader

- **Where**: `web/src/components/chat/MessageList.tsx:227-233`
- **What**: `onScroll` sets `prepend.current = { height: el.scrollHeight }` and calls `loadOlder`. The `!loading` guard reads `loading` from the render snapshot, but the store sets `loading` synchronously (`stores/messages.ts:375`) and React has not re-rendered yet, so a second scroll event in the same frame passes the guard. The store makes that second call a no-op that resolves in a microtask, and its `.finally` then runs `if (… scrollHeight === prepend.current.height) prepend.current = null` — true, because nothing has changed yet. The *real* in-flight page's anchor is now null, so when it lands the `useLayoutEffect` at `:140` takes no branch and `scrollTop` is not compensated for the ~50 inserted rows.
- **Repro**: Fling-scroll to the top of a long channel. When the older page arrives the view snaps to unrelated older content instead of holding position. Two scroll events landing before a React commit is common during a fling.
- **Fix**: Guard with a ref rather than render state, and only let the call that set `prepend.current` clear it.

### [RACE] One viewer's abort fails the attachment download for every other viewer

- **Where**: `web/src/lib/mediaCache.ts:75-79`
- **What**: `attachmentObjectURL(att, signal)` dedupes by `att.blob_id` through the `inflight` map, but the `AbortSignal` that is actually wired into `fetch` is the *first* caller's (`:79`). A second caller receives the first caller's promise and inherits its cancellation, with no way to opt out.
- **Repro**: Scroll a large image into view so its row starts downloading, then click it to open the lightbox, then scroll the row out of view so its effect aborts. The lightbox — which never aborted anything — fails with an `AbortError`. It also poisons nothing: `inflight.delete` runs in the `finally`, so a retry works, but the viewer sees a broken image first.
- **Fix**: Give the shared job its own `AbortController` that aborts only when every subscriber has, and count subscribers.

### [RACE] Late emoji-index load re-opens the autocomplete with stale text and a stale caret

- **Where**: `web/src/components/composer/Composer.tsx:218`
- **What**: `if (!emojiLoaded()) void loadEmoji().then(() => refreshAc(value, caret));` — `value` and `caret` are captured from the keystroke that triggered the load. Nothing checks that the box still holds that text, that the caret is still there, or that the Composer is still on the same channel. `refreshAc` calls `setAc({ … start: tok.start … })` and `pickAc` then splices at `ac.start` (`:284-288`).
- **Repro**: Type `:sm` quickly on a cold load, before the emoji index is fetched, then clear the box or switch channels. When `loadEmoji()` resolves the popup reappears for text that is no longer there; picking an entry splices into the wrong offset of whatever is now in the box.
- **Fix**: Re-derive from the live element (`taRef.current.value` / `.selectionStart`) inside the `.then`, and bail if the channel changed.

### [RACE] Mark-unread sends two contradictory acks and zeroes the mention count

- **Where**: `web/src/components/chat/messageMenu.ts:124-126`
- **What**: Two problems. (a) When the picked message is the first loaded one, `prev === "0"`, and `:125` sends `messagesApi.ack(channelId, msg.id)` — an ack that marks that very message **read** — while `:126` sends the `manual: true` ack for `0` that marks it unread. Nothing sequences them; whichever lands last wins. `:125` also has no `.catch`, so a failure is an unhandled rejection. (b) The optimistic local write hard-codes `mention_count: 0`.
- **Repro**: Scroll to the top of a channel's loaded page and choose **Mark Unread** on the topmost message — the read state flips depending on request ordering. Separately: read a channel where you were mentioned, mark unread from a point above the mention, and the channel shows unread with no mention badge.
- **Fix**: `await` the forced ack instead of firing both, and recompute the mention count from the messages after `prev`.

### [RACE] An unrecognised `voice_error` hangs up locally without telling the server, leaving a ghost participant

- **Where**: `web/src/voice/session.ts:881`
- **What**: `if (session && !useVoice.getState().mine) void leaveVoice(false);` — `notify = false` means `sendState(null)` is never sent. `mine` is null for the whole window between `sendState(channelId)` (`:411`) and the server's own `voice_state` coming back (`:802`). Only `SIGNAL_ERRORS` (`:116`) and `MODE_ERRORS` (`:118`) are filtered out beforehand; any other code reaching this line inside that window tears the call down silently.
- **Repro**: Join a call and have the server emit any `voice_error` whose code is not in those two sets (a rate limit, a permission recheck) before your own `voice_state` round-trips. Your client closes the transport and resets the store, but the server still has you in the call — everyone else keeps seeing your tile until the session times out, and rejoining the same channel is refused because the server thinks you are already there.
- **Fix**: Use `leaveVoice(true)` here; the server ignoring a redundant `voice_state: null` is far cheaper than a ghost.

### [RACE] `switchCamera()` kills the live camera before it knows the replacement can open

- **Where**: `web/src/voice/session.ts:555-560`
- **What**: The old tracks are stopped (`t.onended = null; t.stop()`) *before* `s.cameraPending = true` and before `await getCamera(...)`. Throughout that await `s.camera` still points at the dead stream, `useVoice.localVideo` still holds it, and the transport's sender still carries the stopped track. `flipCamera` (`:592-596`) has the same shape, but the comment at `:589-591` shows it is deliberate for phones; `switchCamera` is triggered by a settings change on desktop, where it is not.
- **Repro**: With your camera on in a call, open the camera menu and pick a different camera. Your own tile freezes on the last frame and everyone else sees a frozen picture for as long as `getUserMedia` takes. If the new camera is busy (another app holds it) you end up with the camera off entirely and a toast, having lost a working camera.
- **Fix**: Open the new camera first and stop the old one only once the new stream is in hand; keep the stop-first path behind the phone check `flipCamera` documents.

### [LEAK] Auto-loaded video and audio attachments are pinned in memory and can never be evicted

- **Where**: `web/src/components/chat/Attachments.tsx:197` and `:218`
- **What**: `useDecrypted(att, auto)` passes `eager = auto = att.size <= 25 MB`, so every video and audio attachment up to 25 MB starts downloading and decrypting the moment its row mounts — there is no `useInView` gate (images get one at `:159`; video and audio do not). Each decrypted blob calls `acquire()` (`:54`), and `evict()` explicitly skips anything with `refs > 0` (`lib/mediaCache.ts:36`). `MessageList` renders every row with no virtualization (`MessageList.tsx:373`) and the store never trims `ids`, so every such blob stays mounted, referenced and un-evictable. The 200 MB `BUDGET` is unenforceable.
- **Repro**: Open a media-heavy channel and scroll up a few pages. Tab memory climbs by the full decrypted size of every clip, well past 200 MB, and never comes down until you leave the channel.
- **Fix**: Gate video and audio behind `useInView` the way images are, and release the cache ref when a row scrolls far out of view.

### [LEAK] Staged attachment previews are never revoked

- **Where**: `web/src/components/composer/Composer.tsx:174`, `:306`, `:473`
- **What**: `stage()` creates an object URL for every image and video (`lib/attachments.ts:49`). Three paths leak it. At `:174` the channel-change cleanup iterates `files`, but the effect's deps are `[channel.id]`, so the cleanup React actually runs closes over `files` as it was when the effect last executed — `[]`. At `:473` the tray's delete button does `setFiles(cur => cur.filter(...))` with no revoke. At `:306` `.slice(0, 10)` silently discards files past ten; their previews leak *and* the user is never told files were dropped.
- **Repro**: Stage a 200 MB video, click the trash icon, repeat. Each dropped clip stays resident for the life of the tab. Or stage twelve images and watch two vanish with no message.
- **Fix**: Revoke in the delete handler and in `addFiles` for the overflow (and toast about the limit); hold the files being cleaned up in a ref.

### [LEAK] `MessageItem` subscribes to the UI store per context menu and never unsubscribes on unmount

- **Where**: `web/src/components/chat/MessageItem.tsx:116-121`
- **What**: `openMenu` creates `const unsub = useUI.subscribe(...)` that calls `unsub()` only from inside its own callback, when `state.contextMenu` becomes falsy. If the component unmounts while the menu is open the subscription stays in the store's listener set forever and later calls `setMenuOpen` on an unmounted component. No `useEffect` owns it.
- **Repro**: Right-click a message, then switch channels (`MessageList` is keyed per channel at `ChatView.tsx:299`, so every row unmounts). The listener survives. Repeat and the listener set grows without bound.
- **Fix**: Hold the unsubscribe in a ref and clear it from `useEffect(() => () => unsubRef.current?.(), [])`.

### [LEAK] The derived channel-key cache is never evicted

- **Where**: `web/src/lib/keyring.ts:6`, populated at `:16`
- **What**: `chanKeys` is a plain `Map` keyed `conv:epoch:channelId`, holding a 32-byte key per entry, and nothing ever deletes from it except `clearKeyring()` on sign-out or reset. A rotation adds a whole new epoch's worth of entries without retiring the old one, and the old epoch's keys must be kept anyway to read history — but they never expire either.
- **Repro**: Theoretical in size but certain in behaviour: every channel of every server you read, times every key epoch that server has ever had, accumulates for the life of the tab. On a busy instance with frequent membership changes (each of which rotates a key — `dispatch.ts:266`), this is the fastest-growing unbounded structure in the app.
- **Fix**: Bound it (an LRU keyed by last use) or drop entries for epochs older than the newest two when a rotation lands.

### [LEAK] `api.upload`'s abort listener is never removed

- **Where**: `web/src/api/client.ts:235`
- **What**: `signal.addEventListener("abort", () => xhr.abort(), { once: true })` is only removed when the signal actually fires. A long-lived `AbortSignal` shared across many uploads accumulates one listener — and one retained `XMLHttpRequest` — per completed upload.
- **Repro**: Theoretical today: no caller in `web/src` passes a `signal` to `api.upload` (grep confirms `lib/attachments.ts:91`, `:112`, `api/users.ts:26`, `api/servers.ts:45`, `api/channels.ts:35`, `api/expressions.ts:9` all omit it). It is a trap waiting for the first caller that does.
- **Fix**: `const off = () => signal.removeEventListener("abort", onAbort)` called from `finish`.

### [LEAK] `pip()` builds a detached `<video>`, plays a live stream into it, and never releases it

- **Where**: `web/src/components/voice/VoiceView.tsx:425-433`
- **What**: `const el = document.createElement("video"); el.srcObject = t.stream; … void el.play().then(() => el.requestPictureInPicture()).catch(…)`. The element is never appended to the document, never paused, and its `srcObject` is never cleared, so it keeps a decode pipeline and a reference to the remote `MediaStream` alive for the life of the page. The `.catch` swallows the failure entirely, so on browsers that require the element to be in the document the button does nothing visible and still leaks.
- **Repro**: Click the picture-in-picture button on several tiles during a call; each click leaks one playing detached video. (That the request itself fails on Chrome is likely but was not run; the leak is certain from the code.)
- **Fix**: Reuse one hidden element, append it, and on `leavepictureinpicture` clear `srcObject` and remove it. Surface the rejection instead of swallowing it.

### [LEAK] `lossSeen`, `lossTold` and `repulls` grow for the life of the transport

- **Where**: `web/src/voice/sfu.ts:703` and `:722`
- **What**: `this.lossSeen.set(s.mid, …)` and `this.lossTold.set(p.userId, now)` have no matching deletes anywhere — not in `unsubscribe()` (`:833`), not in `removePeer()` (`:630`), not in `reset()` (`:374`). `lossSeen` is keyed by mid, which a new connection reuses from 0.
- **Repro**: Sit in a busy voice channel for an hour with people coming and going; the three maps hold one entry per mid and per user forever. Theoretical as a memory problem at realistic sizes; the cross-connection reuse is what actually bites (see the `repulls` finding above). The counter-rollback guard at `:702` saves correctness for `lossSeen` itself.
- **Fix**: Delete the entries in `unsubscribe()`/`removePeer()` and clear all three in `reset()`.

### [LEAK] `audioContext()` adds `visibilitychange` and `pagehide` listeners it never removes

- **Where**: `web/src/voice/media.ts:237` and `:240`
- **What**: On first call the module registers two listeners closing over `k`, with no removal path and no reference kept to detach them. `sharedKeeper` is a module singleton so this happens once per page, which makes it survivable — but the `AudioKeeper` can then never be replaced.
- **Repro**: Theoretical in production (one page, one singleton). Visible in tests and under Vite HMR, where each module re-evaluation stacks another pair of listeners all calling `k.release()`.
- **Fix**: Keep the handler references on the keeper and remove them in a `dispose()`.

### [BAD] Two owners fight over `ui.focused`, and one of them is known to lie in Electron

- **Where**: `web/src/components/shell/ThemeEffect.tsx:29` against `web/src/components/desktop/DesktopEffects.tsx:133`
- **What**: `DesktopEffects` sets `ui.focused` from the desktop app's authoritative window state — `w.focused && w.visible && !w.minimized` — precisely because, as the comment at `:129-130` says, "the page never counts as hidden here … and its own focus reading was seen to stay true with another app in front". `ThemeEffect` then sets the *same* flag from `document.visibilityState === "visible" && document.hasFocus()`, plus bare `focus`/`blur` listeners. Both components are always mounted (`App.tsx:21`, `AppShell.tsx:172`). Whichever event fires last wins, and `ui.focused` is what `dispatch.ts:144` uses to decide an incoming message is "visible" and should be marked read.
- **Repro**: The provable half: `lib/notify.ts` was fixed for this and the read-state path was not. `appOnScreen()` (`notify.ts:78-83`) explicitly prefers `useDesktop.getState().window` over `document.hasFocus()`, with the comment "the desktop app says where its window is; inside it the page is never hidden, and its focus reading was seen to stay true". `dispatch.ts:144` reads the raw `ui.focused` flag instead, and `ui.focused` still has `ThemeEffect` as a second writer. So the notification decision is desktop-aware and the mark-as-read decision is not, from the same underlying question. The concrete override — a page `focus` or `visibilitychange` firing after `onWindowState` set `focused: false` — I could not reproduce without running the desktop app, so treat that specific sequence as theoretical; the divergence between the two consumers is not.
- **Fix**: Have `dispatch.ts` call `appOnScreen()` rather than reading `ui.focused`, and have `ThemeEffect` skip its listeners when `useDesktop.getState().window` is non-null.

### [BAD] The dispatcher marks messages read while the reader is scrolled up in history

- **Where**: `web/src/gateway/dispatch.ts:144-146`, against `web/src/components/chat/MessageList.tsx:247`
- **What**: `dispatch` acks a new message whenever `ui.activeChannelId === m.channel_id && ui.focused && document.visibilityState === "visible"`. `MessageList`'s own ack effect twenty lines of behaviour away is far stricter — it also requires `!hasNewer`, `atBottom.current`, and a first page to have loaded, with the comment at `MessageList.tsx:222-224` stating the rule explicitly: "The end of a list that stops short of the present is not the bottom: nothing should stick to it or be marked read from it." The dispatcher ignores all of that.
- **Repro**: Open a busy channel and scroll up five hundred messages to read history. A new message arrives. `dispatch` acks it, `markRead` zeroes `mentions` and `unread` (`readStates.ts:107`), the unread divider disappears and the sidebar badge clears — for a message you never saw and that is not even on screen.
- **Fix**: Have `dispatch` ack only when the store says the list reaches the present and the reader is at the bottom, or delegate the decision to `MessageList` entirely and let `dispatch` only count.

### [BAD] Escape acks the newest *loaded* message, wiping mentions you have not read

- **Where**: `web/src/components/shell/Shortcuts.tsx:77-85`
- **What**: The Escape handler takes `st.ids[st.ids.length - 1]` and acks it, with no check on `hasNewer`. When the list has been jumped into history that id is an *old* message, and `markRead` (`readStates.ts:103-108`) unconditionally sets `lastReadId` to it and zeroes `mentions` and `unread`.
- **Repro**: Click a reply preview or a search result to jump far back in a channel (`hasNewer` is now true). Press Escape to dismiss the jump. The channel's mention badge goes to zero and `lastReadId` moves *backwards* on the server, so the next `ready` brings back a read state older than where you actually were.
- **Fix**: Skip the ack when `hasNewer` is true, or ack `channel.last_message_id` from the channels store rather than the newest loaded id.

### [BAD] A deleted mention leaves the mention badge inflated forever

- **Where**: `web/src/gateway/dispatch.ts:163` and `web/src/stores/readStates.ts:96-102`
- **What**: `message_delete` calls `dropUnread`, which decrements `unread` only. There is no `dropMention`, and `bumpMentions` (`:86`) is the only writer of the counter besides the two places that zero it. So the two counters, bumped together at `dispatch.ts:148-151`, are not taken back together.
- **Repro**: Someone `@`-mentions you in a server channel you are not reading, then deletes the message. The red mention pill stays at 1 on the channel, on the server in the rail (`serverUnread` sums `rs.mentions`, `lib/unread.ts:55`) and in the tab title (`lib/title.ts:25`) until you open that channel. There is nothing left to read there.
- **Fix**: Track which message ids were counted as mentions per channel (or re-derive from the loaded page) and decrement on delete. Note the Android client decrements neither (`android/…/data/Session.kt:413-416` has no drop at all), so a fix should land on both — but the web's half-done version is the inconsistent one.

### [BAD] A message that arrives while the reader is in history is dropped, and its notification says "New message"

- **Where**: `web/src/stores/messages.ts:132-136` (`arrived`) and `web/src/lib/notify.ts:97-104` (`previewOf`)
- **What**: `arrived` deliberately refuses messages past the end of a list that stops short of the present — correct, because the ones in between are missing. But `previewOf` reads the message back out of the store to build the notification body, and it is not there, so it falls through to `t("notify.newMessage")`.
- **Repro**: Jump to an old message in a DM (search result, reply preview), then switch to another app. Your friend sends "see you at six". The notification reads "New message" with no preview, while the identical message in any other state shows its text.
- **Fix**: Pass the decrypted message to the hook rather than looking it up — `dispatch.ts:153` already has `decrypted` in hand and passes only the raw `m`.

### [BAD] `reconcile()`'s rejection is unhandled, and one failure abandons every remaining conversation

- **Where**: `web/src/stores/keys.ts:156-165`, called at `web/src/gateway/dispatch.ts:127`
- **What**: `const needs = await keysApi.needs()` has no `try`/`catch`, and the loop `await get().grantTo(...)` / `await get().rotate(...)` is unguarded — one throw exits the whole function, skipping every conversation after it. The caller is a bare `void useKeys.getState().reconcile()`.
- **Repro**: Reconnect while the server is briefly unhappy. `GET /keys/needs` 500s: an unhandled rejection, and nobody who joined a conversation while you were offline gets a key from this device. Or the list succeeds and the third conversation's `putGrants` fails: conversations four onward are skipped silently. Either way those people see "encrypted message" until another holder comes online.
- **Fix**: `try`/`catch` around the call and around each conversation's turn in the loop, and count failures so they can be retried.

### [BAD] A transient network error silently locks someone out of a conversation key

- **Where**: `web/src/stores/keys.ts:55-60`
- **What**: `putGrantsFor` wraps each user's `publicKeyOf(uid)` and `wrapGrant` in `try { … } catch { /* unknown user: skip */ }`. The comment says "unknown user", but the `catch` also swallows a 500, a timeout and an offline `fetch`. That user is simply dropped from `uploads` and never retried.
- **Repro**: Rotate a key in a conversation (anyone joins or leaves — `dispatch.ts:266`) at a moment when `GET /users/:id/public-key` fails for one member. They receive no grant for the new epoch, and every message from then on reads "encrypted message" for them until someone else rotates again. Nothing tells either side.
- **Fix**: Distinguish `ApiError` 404 (genuinely unknown, skip) from everything else (collect and retry, or fail the rotation).

### [BAD] `upsertMembers` updates the member map but not `me` or `myPermissions`

- **Where**: `web/src/stores/servers.ts:131-138`
- **What**: Every other member mutation recomputes the current user's permissions — `updateServer` (`:85`), `upsertRole` (`:99`), `upsertRoles` (`:107`), `removeRole` (`:119`), `upsertMember` (`:129`). The bulk loader does not: it writes `members` and `membersComplete`, leaving `cur.me` and `cur.myPermissions` untouched.
- **Repro**: Open a server with more than a thousand members so the member list pages in (`components/server/pages/MembersPage.tsx:33-50` and `components/chat/MemberList.tsx:59`). Your own `Member` row comes down in that bulk load. If your roles changed since `ready` — a moderator gave you a role, and `member_update` was missed across a reconnect — `st.members[me]` is now fresh while `st.me` is stale, so `memberColor` shows the new colour while `canI()` still uses the old permission bits. The moderation buttons on that very page (`MembersPage.tsx:62-65`) are drawn from the stale value.
- **Fix**: In `upsertMembers`, refresh `me` when the list contains it and recompute `myPermissions`, as every sibling does.

### [BAD] `installTitleBadge` walks every channel on every change to any of four stores

- **Where**: `web/src/lib/title.ts:41-44`, computing `unreadTotal()` at `:17-28`
- **What**: Four unfiltered `store.subscribe(apply)` calls, each firing on *any* change to that store. `apply` iterates `Object.values(channels)` and every relationship. `useChannels` fires on `setLastMessage`, i.e. every message in every channel. `useSettings` fires on every `patch`, which includes every draft save (`Composer.tsx:195`, debounced to 600 ms of typing idle). `DesktopEffects` (`:105`) has a second identical set of four subscriptions computing the same `unreadTotal()` for the taskbar badge.
- **Repro**: A busy instance with a few hundred channels: every incoming message anywhere runs two full sweeps of the channel map and writes `document.title`. Not a correctness failure, but it is the app's hottest wasted path and it scales with the number of channels rather than with what changed.
- **Fix**: Subscribe with a selector (`subscribeWithSelector`) or memoise on a cheap key, and share one computation between the title and the badge.

### [BAD] The search panel re-runs the whole search on every message-store write

- **Where**: `web/src/components/search/SearchPanel.tsx:30`, `:38`, `:42-46`
- **What**: `const store = useMessages((m) => m.channels)` and `const channels = useChannels((c) => c.byId)` subscribe to whole maps, and `withChannel` (`stores/messages.ts:110-113`) builds a new `channels` object on *every* write even when the updater returns the channel unchanged. So any reaction, any decryption result, any incoming message in any channel changes `store`'s identity. `scope` (`:38`) then rebuilds, `channelNames` rebuilds, and `results` (`:42`) re-runs `search()` across every loaded message in the whole server.
- **Repro**: Open search in a server with several channels of loaded history, then have `redecrypt` run (a key grant arrives, `stores/keys.ts:120`). That calls `setDecryption` once per matching message, each a separate store write, each re-running the full search. With a thousand loaded messages the tab locks up.
- **Fix**: Have `withChannel` return the previous state object when `fn` returns `c` unchanged, and select narrower slices in the panel.

### [BAD] The search panel's index effect depends only on `scope.length`

- **Where**: `web/src/components/search/SearchPanel.tsx:83-87`
- **What**: `}, [scope.length]);` with `react-hooks/exhaustive-deps` disabled. Membership changes that keep the count the same do not re-run it, and `loadInitial`/`markFailed` are read from a stale closure.
- **Repro**: With search open in a server, have one channel deleted and another created (a common pair during a reorganisation). `scope.length` is unchanged, so the new channel's first page is never loaded and its messages are invisible to search with no indication why.
- **Fix**: Depend on a stable key derived from the ids, e.g. `scope.map(c => c.id).join(",")`.

### [BAD] `<t:…>` timestamps build two `Intl` formatters per render and follow the browser's language, not the app's

- **Where**: `web/src/markdown/render.tsx:297`, `:305`, used at `:314-316`
- **What**: `new Intl.RelativeTimeFormat(undefined, …)` and `new Intl.DateTimeFormat(undefined, …)` — constructed fresh on every render, and passed `undefined` for the locale, which means the browser's. `lib/time.ts` exists precisely to avoid both: it caches formatters per locale (`:21-36`) and passes `translator().locale` with the comment "Intl is given the app's tag rather than `undefined`, which would follow the browser: someone reading Nexa in Arabic on an English system wants Arabic months beside Arabic words, not a line that changes language halfway."
- **Repro**: Set the app to Arabic on an English-locale machine and read a message containing `<t:1767225600:F>`. The surrounding text is Arabic; the date inside it is English. Separately, `Timestamp` renders two formatters per timestamp per render (one for `title`, one for the body), so a channel full of them is measurably slow.
- **Fix**: Route both through `lib/time.ts`'s cached `fmt()`, extended with the `<t:>` styles.

### [BAD] `RenderNodes` keys by array index, so a spoiler can reveal itself after an edit

- **Where**: `web/src/markdown/render.tsx:44-46`
- **What**: `nodes.map((node, i) => <Fragment key={i}>…)`. Most nodes are stateless, but `Spoiler` (`:183`) holds `revealed` and `CodeBlock` (`:407`) holds async highlight state. Index keys make React reuse that state across a *different* node when the list shifts.
- **Repro**: A message reads `||first|| and ||second||`. Click the first spoiler to reveal it. The author edits the message to delete the first spoiler. The second spoiler now occupies the index the revealed one had, inherits `revealed = true`, and shows its hidden text without anyone clicking it.
- **Fix**: Key on a stable identity — node type plus a running per-type counter, or a content hash.

### [BAD] `AppShell` mutates react-router's memoised `URLSearchParams`

- **Where**: `web/src/components/shell/AppShell.tsx:35-42`
- **What**: `params.delete("settings")` mutates the object `useSearchParams()` memoises on `location.search` and hands to every other consumer, then passes the same mutated object back to `setParams`. The effect's deps include `params`, so it re-runs on the resulting navigation.
- **Repro**: Open `/channels/@me?settings=voice`. The effect opens the settings modal and strips the query. In React 18's `StrictMode` (`main.tsx:53`, on in development) the effect body runs twice before the navigation commits: the second run reads `params.get("settings")` as `null` — because the first run already mutated the shared object — so it is a no-op and the modal opens once. It works, but only by accident; any change to when the effect re-runs turns it into "the modal opens twice" or "the query is never cleared".
- **Fix**: `const next = new URLSearchParams(params); next.delete("settings"); setParams(next, { replace: true });`

### [BAD] `AppShell`'s body-overflow cleanup clears a lock it may not own

- **Where**: `web/src/components/shell/AppShell.tsx:58-64`
- **What**: The effect sets `document.body.style.overflow` to `""` in its cleanup unconditionally, with no record of what was there before. Modals set the same property.
- **Repro**: On a phone, open the left drawer, then open a modal from it (which locks scrolling), then close the drawer. `leftOpen` changes, the cleanup runs, and `overflow` is reset to `""` while the modal is still open — the page behind the modal scrolls again. Theoretical unless a modal also writes `body.overflow`; worth checking against `Modal.tsx` when fixing.
- **Fix**: Save and restore the previous value, or use a shared reference-counted scroll lock.

### [BAD] `close()` keeps the send queue, so frames from a previous session flush onto the next socket

- **Where**: `web/src/gateway/client.ts:197-210`, queue at `:48` and `:242-247`
- **What**: `close()` clears the timers and the socket but leaves `this.queue` populated. `connect()` (which `wake()` and `scheduleReconnect` both reach) calls `flush()` in `onopen`, sending everything that was queued.
- **Repro**: `stopSession()` on auto-lock closes the client and nulls the module-level `client`, so today nothing reuses the instance and this is latent. Reintroduce any reuse — or call `close()` then `connect()` on the same client — and presence, activity and voice frames addressed to the previous session are replayed to the new one.
- **Fix**: Clear `this.queue` in `close()`.

### [BAD] `ensureUser` has no in-flight dedupe

- **Where**: `web/src/gateway/dispatch.ts:85-92`, compared with `ensureChannel` at `:73-83`
- **What**: `ensureChannel` guards with a `channelFetches` set; `ensureUser` checks only whether the user is already in the store. Two events for the same unknown user, or twenty, all fire `usersApi.get(id)`. `stores/messages.ts:10-29` has the dedupe done properly (`authorFetches`) — dispatch just does not use it.
- **Repro**: A user nobody has loaded posts a burst of ten messages (or is added to ten channels). Ten identical `GET /users/:id` requests go out. Small, but it is the same function written correctly twice elsewhere in the same file.
- **Fix**: Reuse `resolveAuthors` from the messages store, or add the same `Set` guard.

### [BAD] `withChannel` resurrects channels that were just deleted

- **Where**: `web/src/stores/messages.ts:110-113`
- **What**: `const cur = s.channels[channelId] ?? emptyChannel();` then `{ channels: { ...s.channels, [channelId]: fn(cur) } }` — it writes the entry back unconditionally, even when `fn` returns `cur` untouched. Every setter that runs for a channel the store does not have (or no longer has) creates a fresh `ChannelMessages` record with `loaded: false, hasOlder: true`.
- **Repro**: Leave a server. `dispatch.ts:203` calls `clearChannel` for each of its channels. Any `setDecryption` still in flight from `redecrypt` — or a `pin_update`, `setLoading`, `setHasOlder` — then re-creates the entry. `channels` accumulates empty records for every channel ever deleted, and `useMessages.getState().channels[id]` starts answering truthy for a channel that is gone.
- **Fix**: Return `s` unchanged when `fn(cur) === cur` and `channelId` was not already present.

### [BAD] `redecrypt` does one store write — and one render pass — per message

- **Where**: `web/src/stores/messages.ts:441-455`
- **What**: Each job calls `get().setDecryption(...)` independently, and every `setDecryption` goes through `withChannel`, producing a brand-new `channels` object. There is no batching.
- **Repro**: A key grant arrives for a conversation with two thousand loaded messages (`stores/keys.ts:120` after `ingestGrants`). Two thousand sequential store writes fire, each waking every subscriber — including `SearchPanel`'s full-corpus search (see above) and both `unreadTotal()` sweeps. The tab freezes for seconds.
- **Fix**: Collect the results and apply them in one `set`.

### [BAD] `adoptPolicy` counts a wrong passcode and throws the count away

- **Where**: `web/src/lib/appLock.ts:206-210`
- **What**: On a verifier mismatch it reads `loadLock(userId)`, computes `failures = (cfg?.failures ?? 0) + 1`, reports `MAX_FAILURES - failures` in the thrown `WrongPasscode` — and never calls `saveLock`. `unlockIdentity` (`:243-247`) does persist its count; this path does not. And in this path `loadLock` is null by construction (it is the "this device has no lock yet" branch, `stores/auth.ts:215`), so `failures` is always 1.
- **Repro**: On a device that has never seen the account's passcode, get the passcode wrong. The screen says "9 tries left". Get it wrong again — still "9 tries left". There is no limit at all: the wrapped key is never thrown away here because there is no wrapped key yet, and the verifier can be guessed against offline as many times as you like. The message tells the user otherwise.
- **Fix**: Persist the count (a small record keyed on the user id even without a `LockConfig`), or stop displaying a tries-left number that is not enforced.

### [BAD] `ensureConvKey` can poison a conversation permanently

- **Where**: `web/src/stores/keys.ts:131`, `:144-146`, `:148`
- **What**: `if (!userId) return null;` at `:131` is *before* the `try`, so the `finally` that does `pendingEnsure.delete(conv)` never runs. `:148` then stores that already-resolved `null` promise in `pendingEnsure`, where `:127-128` returns it to every future caller for the life of the tab.
- **Repro**: Theoretical in the main app — `useKeys.init` sets `userId` synchronously before its first `await` (`:89`), so the window is very narrow. It is reachable in the guest-call path, where `useKeys` is never initialised at all and `voice/session.ts:810` calls `ensureConvKey` from a `voice_state` event. A guest never sends messages, so the consequence is currently nil; but the shape is a latent "one conversation can never be encrypted to again, and every send fails with `waiting_for_key`".
- **Fix**: Move the `userId` check inside the `try`, or `pendingEnsure.set` before creating the job.

### [BAD] `api.request` has no timeout

- **Where**: `web/src/api/client.ts:143-169`
- **What**: `await this.fetchImpl(...)` with no `AbortSignal.timeout` and no deadline anywhere in the stack. A server that accepts the connection and never answers — a hung proxy, a half-open TCP connection after a network change — leaves the promise pending forever.
- **Repro**: Switch from Wi-Fi to cellular mid-request. Every in-flight `api.request` hangs. Buttons that set `busy` in a `try`/`finally` stay disabled and spinners spin; the gateway recovers via its heartbeat but HTTP has no equivalent.
- **Fix**: Attach a default timeout signal (composed with any caller signal) of, say, 30 s.

### [BAD] A network failure reaches callers as a bare `TypeError`, not an `ApiError`

- **Where**: `web/src/api/client.ts:160`
- **What**: `fetch` rejects with `TypeError: Failed to fetch` and nothing converts it. `ApiError(0, "network", …)` exists but is produced only by `upload` (`:224`) and the upload worker (`lib/attachments.ts:125`). Several callers branch on `err instanceof ApiError` to choose a message and fall back to the raw one.
- **Repro**: Go offline and edit a message. `EditMessage.tsx:46` toasts `err.message`, which is the browser's untranslated "Failed to fetch". `stores/auth.ts:146` had to special-case `err instanceof TypeError` to get this right; every other call site did not.
- **Fix**: Catch in `request` and rethrow as `new ApiError(0, "network", t(…))`.

### [BAD] Member paging failure leaves an incomplete list with no retry

- **Where**: `web/src/components/chat/MemberList.tsx:59`
- **What**: `(async () => { …pages… })().catch(() => {})`. If any page fails the loop stops mid-way. `membersComplete` stays false, but the effect's deps `[complete, serverId, upsertMembers, upsertUsers]` do not change, so nothing retries.
- **Repro**: Open a server with more than a thousand members on a flaky connection. The sidebar shows, say, 1000 of 4000 people with no spinner, no error, and no way to fix it short of navigating away and back.
- **Fix**: Keep the failure in state and retry on `online` or a button, the way `MessageList.tsx:328-343` does.

### [BAD] A failed pins fetch renders as "no pinned messages"

- **Where**: `web/src/components/chat/PinsPanel.tsx:32`
- **What**: `.catch(() => alive && setPins([]))` — an error and a genuinely empty channel produce identical UI (`pins.length === 0` at `:54`).
- **Repro**: Open the pins popover while offline. It states confidently that the channel has no pins.
- **Fix**: Keep an `error` state distinct from `[]` and offer a retry.

### [BAD] `SubchatPanel` eats Escape in the capture phase, so dialogs opened from it cannot be closed

- **Where**: `web/src/components/chat/SubchatPanel.tsx:92-99`
- **What**: The keydown listener is on `document` with `capture: true` and calls `e.stopPropagation()` unconditionally, so it runs before every other Escape handler including modals. The panel stays mounted when it opens one (`subchatMenuItems` at `:38` calls `ctx.openModal("confirm", …)` without closing the panel).
- **Repro**: With the subchat panel open, right-click a subchat → **Delete Subchat**. The confirm dialog opens. Press Escape: the panel closes behind the dialog and the dialog stays.
- **Fix**: Bail when a modal layer is present (`document.querySelector("[data-modal-layer]")`), as `ChatView.tsx:122` does, and drop the capture flag.

### [BAD] `e.stopPropagation()` inside a `setState` updater does nothing

- **Where**: `web/src/components/chat/ChatView.tsx:123-126`
- **What**: `setSearchOpen((open) => { if (open) e.stopPropagation(); return false; })`. React invokes the updater during the next render, long after the native `keydown` finished dispatching. The intent — "when search was open, Escape belongs to search" — is silently not implemented, while the code reads as if it were.
- **Repro**: Open the search box and press Escape. Other document and window Escape handlers (e.g. `SelectionBar.tsx:31`, which bails only for `defaultPrevented` and modal layers) run too.
- **Fix**: Read the current value from a ref and call `stopPropagation()` synchronously in the handler.

### [BAD] Editing a message shows the user the raw error code `waiting_for_key`

- **Where**: `web/src/components/chat/EditMessage.tsx:46`
- **What**: `toast(err instanceof Error ? err.message : …)`. `editMessage` throws `new Error("waiting_for_key")` (`send.ts:117`, `:121`). `sendMessage` maps that code to a sentence (`send.ts:76`); the edit path does not.
- **Repro**: Edit a message in a conversation whose key has not arrived yet and press Enter. A toast reading literally `waiting_for_key` appears.
- **Fix**: Map the code in `save()` the way `sendMessage`'s catch does.

### [BAD] Blocking someone from the friends menu has no error handling

- **Where**: `web/src/pages/FriendsPage.tsx:173`
- **What**: `onSelect: () => void relApi.block(rel.user.id).then(() => setRel({ ...rel, type: "blocked" }))` — no `.catch`. Every other action in the file toasts on failure (`remove` at `:158`, `accept` at `:148`).
- **Repro**: Right-click a friend → **Block** while offline. The row does not change; no toast, no indication anything failed. It is also an unhandled rejection.
- **Fix**: Add a `.catch` that toasts, matching `remove()`.

### [BAD] `as unknown as` hides the shape of the group-join response

- **Where**: `web/src/pages/InvitePage.tsx:93` (and the `as never` casts at `:94-95`)
- **What**: `serversApi.join()` is typed as returning a server view, and the group branch force-casts it through `unknown` to `{ channel: { id, recipient_ids }, users? }` with no validation. If the field is absent or renamed, `res.channel.id` is `undefined` and `:96` navigates to `/channels/@me/undefined`; `DMPage` then fetches channel `undefined`, fails, and bounces home with no explanation.
- **Repro**: Not currently reproducible against the live API, but there is no type or runtime check standing between the two, and the two `as never` casts disable checking on the store writes as well.
- **Fix**: Give `serversApi.join` a union return type (or a separate `joinGroup`) and narrow it.

### [BAD] `next=` redirect target is checked only for a leading `/`

- **Where**: `web/src/pages/LoginPage.tsx:27`, `web/src/pages/RegisterPage.tsx:92`
- **What**: `nav(next.startsWith("/") ? next : "/channels/@me", { replace: true })`. Both `//evil.example` and `/\evil.example` start with `/` and are protocol-relative URLs. `next` is generated into links by `InvitePage.tsx:168-169`, so a crafted link is plausible.
- **Repro**: Visit `/login?next=//example.com` and sign in. The router hands `//example.com` to `history.pushState`; current Chrome and Safari throw a `SecurityError` and strand the user on a blank login page rather than redirecting, but the destination is unvalidated and the failure mode is browser-dependent.
- **Fix**: Require `next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")`, or resolve against `location.origin` and compare origins.

### [BAD] The jump highlight timer is never cleared

- **Where**: `web/src/components/chat/MessageList.tsx:263`
- **What**: `setTimeout(() => setHighlight(null), 2000)` is not stored and not cleared — not on unmount, and not when a second jump starts.
- **Repro**: Click a reply preview to jump to message A, then within two seconds click another to jump to B. A's timer fires and clears B's highlight after about half a second, so you never see which message you landed on.
- **Fix**: Keep the handle in a ref; clear it at the top of the effect and in the cleanup.

### [BAD] `refreshAc` has a stale dependency list

- **Where**: `web/src/components/composer/Composer.tsx:231`
- **What**: Deps are `[users, rels, channel.recipient_ids]`, but the body reads `serverState` (`:205-206`, `:212`), `canEveryone` (`:215-216`) and `isServer`, all derived from the servers store and all changing independently of `users`.
- **Repro**: In a server channel, have a role granted to you that adds `MENTION_EVERYONE`. Type `@e`. `@everyone` does not appear in the autocomplete until something unrelated changes the `users` map. The same staleness applies to the member pool for a server whose members arrive after the callback was memoised.
- **Fix**: Add the missing deps, or read them via `useServers.getState()` inside the callback.

### [BAD] A participant whose frames never open is silent forever, with nothing on screen to say why

- **Where**: `web/src/voice/sfu.ts:894-897`, applied at `:966`
- **What**: `held()` returns `!!p && !p.opened`, and `Playback.effectiveGain` returns 0 while held (`playback.ts:171`). The hold is released only by `onFramesSeen(id, opened=true)` (`:883-887`). If this device never holds the epoch that sealed their frames, `openFrame` returns null for every frame (`frameCrypto.worker.ts:114-123`), `p.seen` is true so `checkBypass` will not repull, and the worker's `dropped` counter climbs where nothing reads it. The speaking ring is suppressed too (`playback.ts:73`), so the tile looks like someone who is simply not talking.
- **Repro**: As a guest, join through a link and have the conversation key rotate while the `guest_keys` relay (`session.ts:189-193`, a 1 s interval) is blocked or the relaying member leaves. You keep seeing everyone's tiles, connected, and hear nothing from anyone, with no message.
- **Fix**: After a few seconds of `seen && !opened`, surface it — a per-tile "can't decrypt" state driven by the worker's `dropped` counter or a second `seen` report.

### [BAD] `useVoice.error` is write-only state, and `resetSession()` never clears it

- **Where**: `web/src/stores/voice.ts:193`, written at `session.ts:330`, `:331`, `:879`
- **What**: `setError` is called on every join refusal and every `voice_error`, but the only reader in the repo is `voice/session.test.ts:42,45`. No component selects `v.error`. `resetSession()` resets eleven fields and leaves `error` alone; only `clear()` (`:194`) drops it.
- **Repro**: Join a full voice channel — the toast appears and vanishes after a few seconds. Switch tabs while joining and you miss it entirely; nothing in the call panel or the lobby ever tells you why the join failed, and the stale message stays in the store for the rest of the session.
- **Fix**: Render `error` in the lobby (`VoiceView.tsx:653-669`) beside the join button, and add `error: null` to `resetSession`.

### [BAD] Clicking a camera-less participant blows their avatar up to fill the stage, and focus is dropped whenever a camera flips

- **Where**: `web/src/components/voice/VoiceView.tsx:511-513`
- **What**: `onStageClick` calls `setFocused(t.key)` for any tile, while the context menu offers "Focus" only when `showsStream(t)` is true (`:449-451`). Separately, the tile key encodes the kind — `` `${p.user_id}:${video ? "video" : "avatar"}` `` (`:305`) — so the key changes when a camera is turned on or off, the focused tile is no longer found, and the effect at `:315-317` clears the focus.
- **Repro**: (a) Single-click anyone with their camera off: a giant avatar takes over the stage, with no Unfocus button because `playing` is false at `:616`. (b) Focus someone's video, then have them turn the camera off and on: focus is silently lost both times, exactly when you most wanted to keep looking at them.
- **Fix**: Guard the click with `showsStream(t)` as the menu does, and key tiles on `${userId}:camera` / `${userId}:screen` independently of whether a stream is present.

### [BAD] `refreshKeys()` re-derives every epoch's key on the main thread every four seconds before checking whether anything changed

- **Where**: `web/src/voice/sfu.ts:324`
- **What**: `const k = voiceKeysFor(this.channelId) ?? …` runs first; the `if (k.version === this.keyVersion) return;` guard is on the next line. `voiceKeysFor` (`e2ee.ts:35`) maps over *every* epoch the ring holds and calls `voiceFrameKey` — an HKDF-SHA256 — for each, synchronously.
- **Repro**: In a long-lived conversation with many rotations, the `keyTimer` (`:253`) does N synchronous HKDF derivations every 4 s for the whole call and throws them all away. Android has the same shape (`android/…/data/KeyService.kt:184-192`), so this is a shared design issue rather than web-only.
- **Fix**: Compute the cheap version string first (`conv:${epochs.join(",")}`) and derive only when it differs.

### [BAD] `mesh.setLocalAudio` hands peers a stream id its sender no longer uses

- **Where**: `web/src/voice/mesh.ts:85`
- **What**: `this.audioStream = new MediaStream(track ? [track] : [])` makes a fresh stream with a new id, but `syncSenders` only calls `peer.audioSender.replaceTrack(sent)` for an existing sender (`:349`) — the sender keeps the original `audioStream` as its msid. `streamIds()` (`:296`) then reports the new id in every signal. The comment at `:101-103` explains exactly why `setLocalVideo` was written *not* to do this; `setLocalAudio` was missed.
- **Repro**: In a mesh call, change your microphone in settings (`refreshMic` → `setLocalAudio`). The peer's `remoteStreams.audio` now holds an id no incoming stream carries. Harmless today because `onTrack` (`:417`) falls back to `e.track.kind`, but the mapping is wrong, and any future kind sharing a media type with audio (screen audio) would be mislabelled.
- **Fix**: Build `audioStream` once in the constructor and add or remove tracks on it, as `setLocalVideo` does at `:104-105`.

### [BAD] `hasSeveralCameras()` writes state after unmount and never re-runs on a device change

- **Where**: `web/src/components/voice/VoiceView.tsx:289-291`
- **What**: `useEffect(() => { void hasSeveralCameras().then(setCanFlip); }, [localVideo]);` — no cancellation flag, no cleanup, and the only dependency is `localVideo`.
- **Repro**: Leave a call (or switch sidebars, which unmounts `VoiceView`) while `enumerateDevices()` is still pending and `setCanFlip` runs on an unmounted component. Separately, plug in a second camera mid-call with your camera already on and the flip button (`:706`) never appears until you toggle the camera off and on.
- **Fix**: Add a `let alive = true` guard with a cleanup, and re-run on `devicechange`.

### [POLISH] `GatewayClient.ready` is written five times and never read

- **Where**: `web/src/gateway/client.ts:49`, written at `:88`, `:116`, `:125`, `:187`, `:207`
- **What**: Dead state. The field is carefully maintained across connect, the `ready` frame, close, heartbeat timeout and user close — and nothing consults it. Whatever it was meant to gate (probably "do not flush until identify is acknowledged") is not implemented.
- **Fix**: Delete it, or use it: `flush()` currently sends queued frames in `onopen`, immediately after `identify` and before the server has answered.

### [POLISH] `authorFetches` retries a permanently-missing user on every page load

- **Where**: `web/src/stores/messages.ts:10`, cleared at `:27`
- **What**: The in-flight guard is removed in `finally`, including after a 404. There is no negative cache.
- **Repro**: Load history containing messages from a deleted account. Every subsequent `resolveAuthors` call — every page of older messages, every jump — fires `GET /users/:id` for them again and gets 404 again.
- **Fix**: Keep a `Set` of ids that answered 404 and skip them.

### [POLISH] `typing.sweep` rebuilds the whole map and never drops empty channels

- **Where**: `web/src/stores/typing.ts:25-38`
- **What**: The sweep allocates a new inner object for every channel on every tick and writes `byChannel[ch] = kept` even when `kept` is empty, so the outer map accumulates one permanently-empty entry per channel anyone has ever typed in.
- **Fix**: Only rebuild the channels that changed, and delete entries that end up empty.

### [POLISH] A hostile message of open brackets costs eleven times an ordinary parse

- **Where**: `web/src/markdown/parse.ts:36` (`RE_MASKED`)
- **What**: `/\[([^\]\n]{0,512})\]\(…\)/y` is tried at every `[`. On a run of `[` the `{0,512}` matches greedily, fails to find `]`, and backtracks 512 times — per bracket. Measured on this machine, bundled with esbuild and run in node: `"[".repeat(8000)` takes **14.17 ms** per `parse()` against **1.27 ms** for 7,200 characters of ordinary prose, and every other adversarial input I tried (long runs of `_`, `*`, `~~`, `||`, backticks, `<`, `:`, alternating markers, deep nesting, unclosed emphasis, marker soup) stayed under 3.5 ms. The depth cap, the memoised failed-closer map and `MAX_SOURCE` do their job everywhere else.
- **Repro**: Send a message of 8,000 `[` characters. It is not a hang — but `Markdown` memoises on `[source, inline, codes]` and a message list re-parses on every cache miss, so fifty such messages in view is roughly 700 ms of parsing per miss. Bounded, so POLISH rather than BROKEN.
- **Fix**: Bail out before the regex when `line.indexOf("]", i)` is absent or further than 512 characters away.

### [POLISH] The link-preview debounce timer is never cleared on unmount

- **Where**: `web/src/components/composer/Composer.tsx:116-122`
- **What**: The effect clears the *previous* timer on each run but returns no cleanup, so a pending timer survives unmount and fires `previews.start(url)` against an object nothing will read. `createLinkPreviews`'s `done` map (`linkPreviews.ts:18`) is also never pruned, accumulating one entry per URL typed for the life of the mounted chat.
- **Repro**: Paste a URL and navigate away within 600 ms — an unfurl request still goes out for a composer that no longer exists.
- **Fix**: `return () => { if (unfurlTimer.current) clearTimeout(unfurlTimer.current); };`

### [POLISH] The `ec:insert-text` effect has no dependency array

- **Where**: `web/src/components/composer/Composer.tsx:129-147`
- **What**: Declared with no second argument, so the window listener is removed and re-added after every render of the Composer — every keystroke. It is written that way to read a fresh `text`, but the file already has the idiomatic tool for that (`textRef`, `:103-104`).
- **Fix**: Use `textRef.current` inside the handler and give the effect `[]`.

### [POLISH] `unreadFrom` is a ref written during render

- **Where**: `web/src/components/chat/MessageList.tsx:102`
- **What**: `if (unreadFrom.current === undefined && loaded) unreadFrom.current = readState?.lastReadId ?? null;` mutates a ref in the render body, and the `rows` memo that consumes it lists `loaded` as a proxy dependency (`:129`) rather than the value. It is idempotent under StrictMode's double render, but it is a side effect during render.
- **Fix**: Capture it in a `useEffect` keyed on `loaded`, or derive it into state.

### [POLISH] Embeds are keyed by array index

- **Where**: `web/src/components/chat/Embeds.tsx:196`, `:198`, `:199`, `:200`, `:201`
- **What**: `key={i}` for a list whose contents change — `editMessage` rewrites `payload.embeds` when the links in the text change (`send.ts:104-109`). Index keys make React reuse `ImageEmbed`'s `open`/`natural` and `LinkEmbed`'s `play` across a different embed.
- **Repro**: A message with two link cards; open the lightbox on the second, and have the author edit the message to remove the first link. The lightbox is now showing a different image from the one you opened.
- **Fix**: Key on `e.url`, with the index as a tiebreaker for duplicates.

### [POLISH] Reaction rollback can clobber a concurrent toggle

- **Where**: `web/src/components/chat/Reactions.tsx:43`
- **What**: `has` is captured from the `msg` prop before the request and the failure path restores exactly that value, so two in-flight toggles of the same emoji roll back against stale snapshots.
- **Repro**: Click a reaction pill twice quickly on a slow connection so an add and a remove are both in flight. If the first fails after the second succeeds, the pill snaps to the wrong state until the gateway echo corrects it.
- **Fix**: Tag each optimistic change with a sequence number and roll back only when it is still the latest.

### [POLISH] Subchat list shows "No subchats yet" when the fetch failed

- **Where**: `web/src/components/chat/SubchatPanel.tsx:79-80`, rendered at `:133`
- **What**: `.catch(() => undefined).finally(() => alive && setLoading(false))` — a failed fetch is indistinguishable from an empty result. Same shape as the pins panel.
- **Fix**: Track the error and say so.

### [POLISH] `StickerPopout`'s info cache grows without bound and repositions on every scroll

- **Where**: `web/src/components/chat/StickerPopout.tsx:20` and `:100`
- **What**: `infoCache` is a module-level `Map` with a 60 s freshness check but no eviction — entries are deleted only on failure (`:28`) — so it grows one entry per distinct sticker ever clicked. Separately, `window.addEventListener("scroll", reposition, true)` calls `setAt(...)` on every capture-phase scroll anywhere in the app while the popout is open.
- **Fix**: Cap the map (or delete on TTL expiry) and rAF-throttle `reposition`.

### [POLISH] Dead expression subscribes every friend row to the auth store

- **Where**: `web/src/pages/FriendsPage.tsx:208`
- **What**: `{meId ? null : null}` renders nothing either way, but `const meId = useAuth((a) => a.me?.id)` at `:111` means every friend row re-renders on any auth store change.
- **Fix**: Delete `:208` and the now-unused `meId`.

### [POLISH] The connection banner is not translated

- **Where**: `web/src/components/shell/AppShell.tsx:162`
- **What**: `{connection === "connecting" ? "Connecting…" : "Disconnected — reconnecting…"}` — two literal English strings in a component where every other string goes through `t()`. This is the most visible text in the app when anything goes wrong, and it is the one piece nobody in Arabic, Japanese or Hindi can read.
- **Fix**: Add the two keys to the catalogues.

### [POLISH] The search panel's heading, hints and result summaries are not translated

- **Where**: `web/src/components/search/SearchPanel.tsx:101`, `:121`, `:139`
- **What**: `"Search"`, the pluralised `` `${results.length} result${results.length === 1 ? "" : "s"}` ``, `-word` / `exclude`, `"[sticker]"` and `` `[${n} file${n === 1 ? "" : "s"}]` `` are literal, sitting between properly translated siblings. The `s`-suffix pluralisation is also wrong for most of the eleven languages the app ships; `i18n/core.ts` has plural forms for exactly this.
- **Fix**: Route through `t()` with `count` values.

### [POLISH] The GIF picker's tab labels and dead-favourite note are not translated

- **Where**: `web/src/components/pickers/GifPicker.tsx:124` and `:146`
- **What**: `{q.trim() ? "Results" : "Trending"}` and `` `${dead.size} favourite${dead.size === 1 ? "" : "s"} no longer load.` `` — the latter on the same line as two `tr_()` calls.
- **Fix**: Route through `tr_()`.

### [POLISH] Slowmode durations are not translated

- **Where**: `web/src/components/server/ChannelSettingsModal.tsx:27-31`
- **What**: `slowLabel` returns `"Off"`, `` `${v}s` ``, `` `${v / 60}m` ``, `` `${v / 3600}h` `` — English abbreviations that do not survive translation, inside a page whose every other label is translated.
- **Fix**: Use `t()` with counts, or `Intl.RelativeTimeFormat`'s unit strings.

### [POLISH] The Rich Presence card's connective text is not translated

- **Where**: `web/src/components/activity/ActivityCard.tsx:37`, `:38`, `:41`, `:67`, `:68`
- **What**: `` `by ${a.state}` ``, `` `on ${a.assets.large_text}` ``, `` ` (${size[0]} of ${size[1]})` ``, `"left"` and `"elapsed"`. `lib/activity.ts` translates the verbs ("Listening to", "Playing") properly; the card that displays them does not translate the words around them. Word order is also fixed in English, which no amount of key-adding fixes without restructuring — `<Tr>` exists for exactly this (`i18n/index.tsx:166`).
- **Fix**: Move the whole line into a `<Tr>` template so the language decides the order.

### [POLISH] `SettingsLayer` portals to `document.body` rather than the fullscreen root

- **Where**: `web/src/components/server/SettingsLayer.tsx:27`, `:52`
- **What**: Every other floating layer uses `usePortalRoot()` (`hooks/usePortalRoot.ts:15`), which mounts inside the fullscreen element when a call or stream is fullscreen, "because the browser draws nothing outside that element". The settings layer hardcodes `document.body`.
- **Repro**: Go fullscreen on a screen share, then open server settings from a keyboard shortcut or a deep link. The layer renders into the body and is invisible while the fullscreen element is up.
- **Fix**: Use `usePortalRoot()`.

### [POLISH] The frame-crypto worker's module imports `@/i18n` and never uses it

- **Where**: `web/src/voice/frameCrypto.ts:2`
- **What**: `import { t } from "@/i18n";` is wedged in front of the file's doc comment, and there are zero `t(` call sites in it. `frameCrypto.ts` is what `frameCrypto.worker.ts:8` imports, and `@/i18n` is `i18n/index.tsx`, which pulls in React and `locales/en.json` and touches `document.documentElement` (`i18n/index.tsx:128-129`) — meaningless in a worker.
- **Repro**: Cosmetic if Rollup tree-shakes the module out of the worker chunk (plausible — `@/i18n`'s top level is a `Map`, a JSON import and an `import.meta.glob`); if it does not, the worker bundle carries React and the English catalogue. Either way it is dead code left by the bulk i18n rewrite, matching the same placement in `e2ee.ts`, `media.ts:10` and `shareQuality.ts:7`.
- **Fix**: Delete the import and restore the file's leading doc comment.

### [POLISH] The two transports disagree on which ICE candidate pair to read RTT from

- **Where**: `web/src/voice/sfu.ts:1017`
- **What**: `if (r.type === "candidate-pair" && (r as RTCIceCandidatePairStats).nominated && … currentRoundTripTime !== undefined)` — `nominated` without `state === "succeeded"`, and it assigns rather than averages, so the last matching pair wins. `mesh.ts:481` does the opposite: `state === "succeeded"` with no `nominated`, averaged over pairs. `checkLoss` (`:660`) uses both conditions together.
- **Repro**: After an ICE restart, a nominated pair that has not reached `succeeded` can supply a stale `currentRoundTripTime`, so the quality pill in `VoiceView` (`:672`) and `VoiceStatus` (`:37`) shows the wrong colour for a few seconds.
- **Fix**: Use the same predicate in all three places — `nominated && state === "succeeded"`.

### [POLISH] `GuestLinkModal.copy()` leaves a timer running past unmount

- **Where**: `web/src/components/voice/GuestLinkModal.tsx:72`
- **What**: `setTimeout(() => setCopied(false), 2000)` is never stored or cleared.
- **Repro**: Copy the guest link and close the modal within two seconds; the timer fires against an unmounted component. Harmless under React 18, but it is the one uncleaned timer in the folder — `VoiceView.tsx:526-531`, `session.ts:93-96` and `sfu.ts:1033-1037` all clean up.
- **Fix**: Keep the handle in a ref and clear it on unmount.

### [POLISH] The security page ignores `lockVersion`, so a passcode adopted elsewhere is invisible to it

- **Where**: `web/src/components/settings/SecurityPage.tsx:52`
- **What**: `const [lock, setLock] = useState<LockConfig | null>(() => (me ? loadLock(me.id) : null));` reads `localStorage` once and is then kept in step only by this page's own actions (`:132`, `:140`, `:147`). `auth.lockVersion` exists precisely as the "this device's lock changed" signal and `AppLockEffect.tsx:42` subscribes to it; `SecurityPage` does not.
- **Repro**: Have the security page open when the account's passcode policy arrives from another device — `applyLockPolicy` (`gateway/session.ts:139`) shows the passcode screen, `adoptPolicy` writes a `LockConfig`, and `bumpLock()` fires. Come back to the settings page: it still offers "Set a passcode" and shows no auto-lock controls, because `lock` is still the `null` it was born with.
- **Fix**: Select `lockVersion` and re-read `loadLock(me.id)` in an effect keyed on it.

### [POLISH] The friend filter lowercases the display name but not the username

- **Where**: `web/src/components/modals/CreateDMModal.tsx:32`
- **What**: `r.user.display_name.toLowerCase().includes(q.toLowerCase()) || r.user.username.includes(q.toLowerCase())` — the second half compares a lowercased query against a raw username.
- **Repro**: If the server ever allows a capital letter in a username, typing it in lower case fails to find that friend while typing it in the original case fails too (the query is lowercased first). Currently masked by usernames being lowercase server-side.
- **Fix**: `r.user.username.toLowerCase().includes(...)`.

### [POLISH] `ringTimers` is declared `let` but never reassigned

- **Where**: `web/src/voice/session.ts:70`
- **What**: `let ringTimers = new Map<...>()` — only `.set`/`.get`/`.delete` are ever used (`:774-775`, `:888-889`). Every other module-level collection in the file is `const`.
- **Repro**: None; it only misleads a reader into thinking the map is swapped somewhere.
- **Fix**: `const`.
