# Android correctness

## Summary

I read every file in scope under `android/app/src/main/java/xyz/evilion/chat/` (data, net, media, notify, service, ui/markdown, ui/chat, ui/main, ui/auth, ui/friends, ui/invite, ui/sheets, ui/common, i18n), plus the manifest, Gradle and ProGuard config, and compared each behaviour against the web client (`web/src/gateway/`, `web/src/stores/`, `web/src/api/`, `web/src/lib/`) which is the same product and is known to work.

The app is not "a bit rough" — there is a small number of defects that each, on their own, make the app feel broken, and they compound:

1. **The gateway dispatches events out of order.** `Gateway.onMessage` launches a fresh coroutine per frame on `Dispatchers.Default` (`net/Gateway.kt:138`). The web client funnels every frame through one serial promise chain (`web/src/gateway/session.ts:45-48`). On Android a `ready` can land after a `message_create`, a `reaction_remove` before its `reaction_add`, an edit before the message it edits.
2. **Nothing recovers messages missed while the socket was down.** The web client runs `syncGap()` after every `ready` (`web/src/gateway/dispatch.ts:128`, `web/src/stores/messages.ts:308-368`). On Android `readyHooks` has **zero registrations**, `AppState.loadedChannels` is never cleared outside sign-out, and `ChatScreen`'s loader is gated on `!loaded.containsKey(channelId)`. So one network drop means the open channel silently stops receiving history for the rest of the process's life.
3. **The heartbeat's liveness counter is a plain non-volatile `var`** written from the OkHttp reader thread and read from a coroutine (`net/Gateway.kt:69,126,171`). A stale read reconnects a perfectly healthy socket every 33 seconds.
4. **Notifications default to "everything".** `SettingsStore.notificationLevel` only consults `perChannel[channelId]` and falls back to `"all"` (`data/SettingsStore.kt:157-160`); the web falls back to `perChannel[serverId]` and then to `"mentions"` for server channels (`web/src/lib/notify.ts:113`). Join one busy server and the phone buzzes for every message anyone sends.
5. **The notification channels are named with raw translation keys**, because `Notifications.ensureChannels` runs in `App.onCreate` (`App.kt:42`) before `Strings.init` in `MainActivity.onCreate` (`MainActivity.kt:67`).
6. **Half the sidebar is not reactive.** Unread badges, the mute switch, category collapse and server order read `StateFlow.value` / `SettingsStore.*` directly instead of `collectAsState()`, so they do not update.
7. **The event pump does blocking network and disk I/O inline** — a `MessagesApi.ack` POST plus up to two user/channel fetches per incoming message (`data/Session.kt:397-403`), and a `SecureStore` file write per key grant.

Counts: **4 CRASH, 4 DATA-LOSS, 23 BROKEN, 27 BAD, 13 POLISH — 71 findings.**

Where I could not prove something from the source alone I say so and name what would confirm it.

---

## Findings

### [CRASH] Two copies of the same file in the composer crash the app
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:226`
- **What**: `items(staged.size, key = { staged[it].file.uri.toString() })`. `staged` accumulates across picker invocations (`staged = staged + picked`, line 138), and the key is the content URI.
- **How it fails**: Attach `photo.jpg`, then tap the attach button again and pick `photo.jpg` a second time. Both entries carry the same URI, the lazy list sees a duplicate key and throws `IllegalArgumentException: Key "content://…" was already used`. The app dies while composing the chat screen.
- **Fix**: Give `Staged` its own generated id (a counter or UUID) and key on that; optionally also de-duplicate by URI when appending.

### [CRASH] A malformed or changed `/users/@me` response takes the app down at launch
- **Where**: `android/app/src/main/java/xyz/evilion/chat/MainActivity.kt:89`, `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:118-141`
- **What**: `LaunchedEffect(Unit) { Session.bootstrap() }` runs an unguarded suspend call. `bootstrap` catches only `ApiException`; a `kotlinx.serialization.SerializationException` from `UsersApi.me()` (`net/Endpoints.kt:75`), or an `IllegalStateException` out of `SecureStore`, propagates out of the `LaunchedEffect` and out of the composition.
- **How it fails**: Server adds/changes a required field, or returns a body that isn't the expected shape — the app crashes on every cold start and cannot be recovered without clearing app data. The web client cannot crash this way because `api/client.ts` failures are caught per-call.
- **Fix**: Wrap the body of `bootstrap()` in `catch (e: Throwable)` mapping unknown failures to `AuthStatus.OFFLINE` with a message, and wrap the `LaunchedEffect` body in a `try`.

### [CRASH] A 90 MB attachment is buffered twice in memory
- **Where**: `android/app/src/main/java/xyz/evilion/chat/media/Uploads.kt:110-112`
- **What**: The single-request path does `ByteArrayOutputStream(total.toInt())`, fills it with the whole encrypted file, then `body.toByteArray()` — a second full copy — and `Api.upload` holds the result for the duration of the request. `singleLimit` defaults to the server's `upload_single_bytes` (90 MiB).
- **How it fails**: Send an 85 MB video. Peak heap is ~170 MB of byte arrays on top of the Compose heap. `android:largeHeap="true"` buys headroom on a flagship; on a 4 GB device the process is killed with `OutOfMemoryError` mid-upload and the message never sends.
- **Fix**: Stream the encrypted chunks into the OkHttp `RequestBody.writeTo(sink)` instead of materialising them, or lower the single-request threshold so anything over ~16 MB goes through `inPieces`.
- **Also**: `total.toInt()` (line 110) and `(end - start).toInt()` (line 158) silently overflow to a negative `Int` if a server ever reports a limit above 2 GiB, and `ByteArrayOutputStream(negative)` throws `IllegalArgumentException`.

### [CRASH] Compose state is written from the OkHttp write thread during upload
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:160-162` via `android/app/src/main/java/xyz/evilion/chat/net/ApiClient.kt:163`
- **What**: `Api.upload`'s `RequestBody.writeTo` calls `onProgress` every 64 KiB from OkHttp's I/O thread; the composer's callback performs `staged = staged.map { … }`, a snapshot state write.
- **How it fails**: A 90 MB upload issues ~1 400 off-main-thread snapshot writes, each invalidating the composer. In the best case this is heavy jank; snapshot writes racing the composition's own applies on a `SnapshotStateList`-backed value have been a source of `ConcurrentModificationException` in the apply observer. I did not reproduce a crash — **running one large upload while scrolling the message list under StrictMode would confirm or clear this.**
- **Fix**: Marshal progress to the main thread (`withContext(Dispatchers.Main)`), and throttle it to ~10 Hz.

---

### [DATA-LOSS] Every message that arrives while the socket is down is lost until the app is restarted
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:637-660` (`onReady`), `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:87-93`, `android/app/src/main/java/xyz/evilion/chat/data/AppState.kt:78`
- **What**: `onReady` replaces channels, read states, presences and servers, but touches neither `messageFlows` nor `loadedChannels`. `ChatScreen` only calls `MessageService.loadInitial` when `!loaded.containsKey(channelId)`. `Session.readyHooks` is declared (`Session.kt:694`) and **never has a hook added to it** — grep confirms zero registrations.
- **How it fails**: Walk into a lift. The socket drops, reconnects 5 seconds later, a fresh `ready` arrives. The three messages sent during those 5 seconds were never delivered as `message_create` and are never fetched. The channel simply skips them. Leaving the channel and coming back does not help, because `loadedChannels[channelId]` is still `true`. Only killing the app fixes it. The web client handles exactly this with `syncGap` (`web/src/stores/messages.ts:308-368`): forward-fill with `after` up to 5 pages, then a 10-page backward refresh to pick up missed edits/deletes/reactions, falling back to `clearChannel + loadInitial` if it can't catch up.
- **Fix**: Port `syncGap`. Register a `readyHook` that, for the currently-focused channel, walks forward from the local tail with `after=`, and re-reads the loaded stretch to reconcile edits and deletes; clear `loadedChannels` and `messageFlows` for every other channel so they reload on next visit.

### [DATA-LOSS] A message sent while a channel is loading disappears
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/MessageService.kt:130-136`
- **What**: `loadInitial` ends with `AppState.messages(channelId).value = decrypted.sortedBy { idOf(it) }` — an unconditional overwrite with no generation check.
- **How it fails**: Open a channel on a slow connection, type and send before the first page lands. The optimistic message is appended at `MessageService.kt:195`; when `MessagesApi.list` returns a moment later, line 133 replaces the whole list and the pending message vanishes from the UI. If the HTTP send then fails, its `failed` marker is written to a list that no longer contains it (line 225) and the text is gone for good. A `message_create` that arrives in the same window is lost the same way. The web client guards every loader with a per-channel `generation` counter checked after each await (`web/src/stores/messages.ts:70-74, 299`).
- **Fix**: Add a per-channel generation counter bumped on clear/reload, checked after the `await`; merge through `insert()` instead of assigning `.value`, preserving `pending` entries.

### [DATA-LOSS] A failed settings save is discarded, and after one version conflict no setting ever saves again
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt:104-111`
- **What**: `flush()` is `runCatching { … }.getOrDefault(false)`. `version` is only advanced on success. There is no dirty-tracking, no retry and no conflict resolution.
- **How it fails**: Change the theme on the phone while the desktop app saves something. The server rejects `version + 1` as stale. Android swallows it, the local `version` stays where it was, and **every subsequent save uses the same stale version and fails the same way** — theme, language, muted channels, per-channel notification levels, drafts, collapsed categories, recent emoji, server order all silently stop persisting. The only escape is a `settings_update` push happening to arrive (`Session.kt:598-601`) and re-syncing the version. Compare `web/src/stores/settings.ts:217-251`: `dirty`/`sending` maps, on 409 it reloads the server copy, re-lays the local changes on top and retries (up to 3), with exponential backoff for everything else.
- **Fix**: Port the dirty/sending model: keep pending changes in a map, on failure merge `sending` back into `dirty`, on 409 `reload()` then retry, and back off (2s, 4s, 8s, cap 60s) on transient errors.

### [DATA-LOSS] A `settings_update` push silently overwrites unsaved local changes
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt:53-66`, `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:598-601`
- **What**: `load()` does `_doc.value = decrypt(...)` wholesale. There is nothing corresponding to the web's `mergeChanges(sending, dirty)` re-application (`web/src/stores/settings.ts:266-267`).
- **How it fails**: Toggle three settings on the phone. Within the 600 ms debounce window another device saves and the server pushes `settings_update`. `reload()` replaces `_doc` and the three changes are gone without a trace — including any in-flight draft.
- **Fix**: As above; re-apply the still-pending changes on top of the reloaded document and flush if anything remains dirty.

---

### [BROKEN] Gateway events are delivered out of order
- **Where**: `android/app/src/main/java/xyz/evilion/chat/net/Gateway.kt:138`
- **What**: `scope.launch { _events.emit(GatewayEvent(type, frame["d"])) }` — one coroutine per frame, dispatched on `Dispatchers.Default`. The order in which those coroutines reach `emit` is whatever the thread pool decides.
- **How it fails**: Concretely — (a) a `message_create` processed before `ready` is inserted into a channel map that `ready` then replaces at `Session.kt:643`, so the message vanishes; (b) `reaction_add` then `reaction_remove` arriving swapped leaves a phantom reaction with count 1 forever (`MessageService.setReaction` has no idempotency); (c) `message_update` before `message_create` updates nothing, so the edit is dropped; (d) `channel_positions` and `channel_create` racing reorders the sidebar wrongly. The web client's single serial queue (`web/src/gateway/session.ts:45-48`) makes all four impossible.
- **Fix**: Replace the SharedFlow fan-out with a `Channel(Channel.UNLIMITED)` written synchronously from `onMessage` and drained by one collector, or make `_events` emission synchronous with `tryEmit` from the socket thread. Either way, one writer, in receive order.

### [BROKEN] The heartbeat counter is not `@Volatile`, so healthy sockets are torn down on a timer
- **Where**: `android/app/src/main/java/xyz/evilion/chat/net/Gateway.kt:69` (`private var framesSeen = 0L`), written at `:126` from OkHttp's reader thread, read at `:166` and `:171` from the heartbeat coroutine
- **What**: A non-volatile, non-atomic `Long` shared across threads with no happens-before edge between the writer and the reader. (On a 32-bit ABI — `armeabi-v7a` is shipped, `build.gradle.kts:65` — a non-volatile `long` is not even guaranteed to be read atomically.)
- **How it fails**: The heartbeat coroutine caches `framesSeen`, never observes the increment the reader thread made when `heartbeat_ack` arrived, concludes the socket is dead, cancels it and reconnects — every 33 seconds, forever. The user sees the app reconnect constantly, typing indicators and presence flapping, and (because of the previous finding) messages going missing at each reconnect. The web client cannot hit this: JS is single-threaded (`web/src/gateway/client.ts:107,179-182`).
- **Fix**: `@Volatile private var framesSeen = 0L`, or an `AtomicLong`.

### [BROKEN] Frames from an abandoned socket are still dispatched
- **Where**: `android/app/src/main/java/xyz/evilion/chat/net/Gateway.kt:125-139`
- **What**: `onMessage` never checks `socket === webSocket`, unlike `dropped()` at `:148`. The web client guards every socket callback (`web/src/gateway/client.ts:99,106,122`).
- **How it fails**: After a heartbeat timeout the old socket is `cancel()`ed (`:178`) and a new one opened. OkHttp may still deliver frames already read from the old socket's buffer. If one of them is a `ready`, `onReady` (`Session.kt:637`) wipes and repopulates the whole store from the *old* session's snapshot, discarding everything the new connection just delivered.
- **Fix**: `if (socket !== webSocket) return` at the top of `onMessage`.

### [BROKEN] The event pump blocks on HTTP for every message from an unknown sender
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:397-403, 676-686`
- **What**: `ensureUser(m.authorId)` and `ensureChannel(m.channelId)` are suspend calls awaited inline in `dispatch`, as is `MessageService.ack` (`:401`). `dispatch` runs on the single collector coroutine at `Session.kt:95-98`, so the whole event stream waits on them. The web fires both as `void ensureUser(...)` (`web/src/gateway/dispatch.ts:140-141`).
- **How it fails**: Join a busy server. Every message from someone not in the `ready` payload costs a `GET /users/{id}` round trip, and every message in the open channel costs a `POST …/ack`, before the next event is even looked at. On a 3G connection the app falls seconds behind: typing indicators stick, presence is stale, incoming call signalling (`voice_signal`) is queued behind message traffic, and key grants arrive late so messages sit on "waiting for the key".
- **Fix**: `scope.launch { ensureUser(...) }`, `scope.launch { ensureChannel(...) }`, and move `ack` off the pump (see also the ack-debounce finding).

### [BROKEN] Notifications fire for every message in every server channel
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt:157-160`, `android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt:71-77`
- **What**: `notificationLevel` looks only at `notifications.perChannel[channelId]` and defaults to `"all"`. The mute check (`Notifications.kt:67`) only tests the channel id. The web resolves `perChannel[channelId] ?? perChannel[serverId] ?? (serverChannel ? "mentions" : "all")` and treats a muted *server* as muting all its channels (`web/src/lib/notify.ts:113-114`).
- **How it fails**: Someone who has muted a whole server on the web, or left server channels at the default, gets a heads-up notification with sound for every single message in it. This alone would make the app unusable on a phone.
- **Fix**: Mirror the web resolution order, including the server-id fallback for both level and mute.
- **Also**: the `wanted` expression at `Notifications.kt:75` ends in `|| true`, which makes the whole `else` branch dead code — a sign the intent was lost.

### [BROKEN] Notification channels are named with raw translation keys
- **Where**: `android/app/src/main/java/xyz/evilion/chat/App.kt:42` calling `notify/Notifications.kt:33-51`, versus `android/app/src/main/java/xyz/evilion/chat/MainActivity.kt:67`
- **What**: `Notifications.ensureChannels` calls `t("modals.quickSwitcher.messages")`, `t("notifications.calls")`, `t("notifications.stayingConnected")` from `Application.onCreate`. `Strings.init` runs later, in `MainActivity.onCreate`. With no catalogue loaded, `Strings.t` returns the key itself (`i18n/Strings.kt:128`).
- **How it fails**: Settings → Apps → Nexa → Notifications lists three categories called `modals.quickSwitcher.messages`, `notifications.calls` and `notifications.stayingConnected`. Android caches channel names, and `ensureChannels` is never called again after `Strings.init`, so they stay that way. `GatewayService.onStartCommand` (`service/Services.kt:34`) has the same problem when the service starts the process (`START_STICKY` restart), producing a foreground notification whose body is `services.connected`.
- **Fix**: Call `Strings.init(this)` at the top of `App.onCreate`, before anything that calls `t()`; re-run `ensureChannels` after a language change.

### [BROKEN] Notifications never clear when the conversation is read
- **Where**: `android/app/src/main/java/xyz/evilion/chat/notify/Notifications.kt:100, 136-140`
- **What**: The only cancel path in the app is `clearRing` for call notifications. Message notifications are posted with `setAutoCancel(true)` and id `channelId.hashCode()`, and nothing cancels them on ack.
- **How it fails**: The phone buzzes while you're not looking. You read the conversation on the desktop, or open the app and read it there — the notification stays in the shade indefinitely. The web has the same gap but hides it behind `tag` replacement and browser behaviour; on Android a stale notification is a persistent, visible wrong state.
- **Fix**: In `MessageService.ack`, call `NotificationManagerCompat.cancel(channelId.hashCode())`; do the same on the `read_state` gateway event so reading elsewhere clears the phone.

### [BROKEN] Tapping a notification on a cold start lands on an empty screen
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/main/MainScreen.kt:50-55`, `android/app/src/main/java/xyz/evilion/chat/MainActivity.kt:136-139`
- **What**: `handleIntent` resolves the channel with `AppState.channels.value[channelId]` (empty at cold start, so `serverId` is `null`) and sets `Route.Chat(null, channelId)`. `MainScreen` then runs `LaunchedEffect(route, channels.size)` which, seeing `!channels.containsKey(chat.channelId)`, immediately resets to `Route.Chat(serverId, null)`.
- **How it fails**: App is not running. A DM notification arrives, you tap it. The app opens, `Session.bootstrap` reaches `READY` before the gateway `ready` arrives, `AppState.channels` is empty, the route is wiped, and you land on "No conversation open" with the drawer sliding out. The deep link is gone. The same applies to `https://chat.evilion.xyz/channels/...` links.
- **Fix**: Keep the requested channel in a pending field until `ready` has populated channels; only bounce the route back once `AppState.channels` is known to be non-empty (or gate the effect on `Session.status == READY && channels.isNotEmpty()`).

### [BROKEN] Guest call links show "this invite is not valid any more"
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/invite/InviteScreen.kt:48-58`, routed from `MainActivity.kt:147`
- **What**: `Route.GuestCall(code)` renders `InviteScreen(current.code, guest = true)` (`ui/main/MainScreen.kt:102`), but `InviteScreen` **never reads the `guest` parameter**. It unconditionally calls `ServersApi.invitePreview(code)` (`/invites/{code}`) instead of `GuestsApi.check(code)` (`/guest/links/{code}`) and `GuestsApi.join(...)`.
- **How it fails**: Open a `https://chat.evilion.xyz/guest/<code>` link on the phone. The server 404s the invite lookup and the screen says "This invite is not valid any more." Guest calls — a shipped feature per the repo history — do not work on Android at all.
- **Fix**: Branch on `guest`: `GuestsApi.check` for the preview, `GuestsApi.join(code, displayName, captcha)` with a name field for the join, then into the call screen.

### [BROKEN] Tapping an invite link inside a message throws away the key that opens the history
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageRow.kt:225-228`
- **What**: `openLink` matches `/invite/([A-Za-z0-9_-]+)` and navigates with `Route.Invite(invite.groupValues[1])` — **no fragment**. `CreateServerSheet` gets this right (`ui/sheets/Misc.kt:272-274`), and so does the intent path (`MainActivity.kt:146`).
- **How it fails**: Someone pastes an invite that carries `#k=<epoch>.<root>` into a DM. You tap it in the app and join. `InviteScreen`'s `KeyService.adopt` (`ui/invite/InviteScreen.kt:111-113`) gets an empty fragment, so nothing is adopted and the entire server history reads "waiting for the key to this message" until somebody online happens to grant it. Tapping the same link from outside the app works. The behaviour differing by *where you tapped* is the confusing part.
- **Fix**: Parse with `InviteLink.parse(url)` and pass the encoded fragment through, exactly as `CreateServerSheet` does.

### [BROKEN] Collapsing a category, reordering servers and the mute switch do nothing
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/main/Sidebar.kt:74, 151`, `android/app/src/main/java/xyz/evilion/chat/ui/sheets/ChannelSheets.kt:268, 316-324`
- **What**: These composables read `SettingsStore.serverOrder`, `SettingsStore.collapsedCategories` and `SettingsStore.mutedChannels`, which are plain getters over `_doc.value` (`data/SettingsStore.kt:115-186`) — not Compose state. Unlike `SettingsScreen`, which subscribes with `val doc by SettingsStore.doc.collectAsState()` (`ui/settings/SettingsScreen.kt:327, 383`) and therefore recomposes, these composables subscribe to nothing that changes when a setting is written.
- **How it fails**: Tap a category header — the arrow doesn't turn and the channels don't fold away. Flip "Mute this conversation" — the switch springs back. The value *is* written, so the change appears the next time the screen is rebuilt, which reads as "it randomly works sometimes".
- **Fix**: Add `val doc by SettingsStore.doc.collectAsState()` to `ServerRail`, `ServerChannels` and `ChannelSettingsSheet` (or better, expose derived `StateFlow`s).

### [BROKEN] Sidebar unread badges do not clear when you read a channel
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/main/Sidebar.kt:219, 318, 344, 98`
- **What**: `ChannelRow` calls `AppState.unreadOf(channel.id)`, which reads `readStates.value` and `channels.value` directly (`data/AppState.kt:221-227`); `DirectMessages` reads `AppState.readStates.value[...]?.unreadCount` at line 344; `ServerRail` calls `AppState.serverUnread` at line 98, which reads `channels.value` and `readStates.value`. None of these are `collectAsState`.
- **How it fails**: Open a channel with 5 unread. `MessageService.ack` updates `readStates` but not `channels`, so nothing invalidates the row. Go back to the drawer — the badge and the bold name are still there. It only clears when a *new message* lands in that channel (which mutates `AppState.channels.lastMessageId` and re-runs the row). Reading on another device never clears it.
- **Fix**: Collect `readStates` (and `presences`, `voiceStates`, `relationships`) with `collectAsState()` in the sidebar composables, or move unread derivation into a `StateFlow` combining the sources.

### [BROKEN] `lastMessageId` can move backwards, corrupting unread state and DM order
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:392`, `android/app/src/main/java/xyz/evilion/chat/data/MessageService.kt:223`
- **What**: Both sites do an unconditional `putChannel(it.copy(lastMessageId = …))`. The web's equivalent refuses to go backwards: `if (ch.last_message_id && compareIds(ch.last_message_id, messageId) >= 0) return s;` (`web/src/stores/channels.ts:35`).
- **How it fails**: Combined with the out-of-order dispatch above, an older `message_create` processed after a newer one sets `lastMessageId` back. `AppState.unreadOf` (`AppState.kt:221-227`) then computes `last > read` as false, so a channel with genuinely unread messages shows as read; and `dmChannels()` (`AppState.kt:175-176`) sorts the conversation down the list.
- **Fix**: Add the monotonic guard.

### [BROKEN] The mark-unread action always fails when only one page is loaded
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageActions.kt:117-127`
- **What**: It picks the previous loaded message, and if there is none acks the literal string `"0"`.
- **How it fails**: Long-press the oldest loaded message and choose "Mark unread". `MessagesApi.ack(channelId, "0")` is sent; the server either rejects it or records message id 0 as read, and the local `AppState.readStates` is never updated either way (the call is `runCatching` with no store write). The sheet closes and nothing visibly happens.
- **Fix**: Use the dedicated unread endpoint if one exists, or at minimum write the optimistic `ReadState` locally and surface the failure.

### [BROKEN] Scrolling past a video attachment downloads the entire video
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/AttachmentViews.kt:132-137`, `android/app/src/main/java/xyz/evilion/chat/media/CoilSetup.kt:41-48`
- **What**: The poster frame is `AsyncImage(model = meta)`, which routes through `AttachmentFetcher` → `AttachmentStore.file(meta)` → download **and decrypt the whole blob** before the decoder is even consulted. `coil-video` is a declared dependency (`build.gradle.kts:183`) but `VideoFrameDecoder` is never registered in the component list, so after all that work there is no frame to show.
- **How it fails**: Open a channel where someone posted three 200 MB videos. The app quietly pulls 600 MB over mobile data and writes 600 MB of plaintext into the cache, to render three black rectangles.
- **Fix**: Don't request a poster for video attachments (show a placeholder plus the play button), or register `VideoFrameDecoder` and fetch only a ranged prefix.

### [BROKEN] A cancelled or failed attachment download is cached as a complete file
- **Where**: `android/app/src/main/java/xyz/evilion/chat/media/AttachmentStore.kt:35, 46-61`
- **What**: `FileCrypto.decryptToFile(stream.input, key, dest)` writes straight to the final path, and `cached()` accepts any file that `exists() && length() > 0`.
- **How it fails**: Tap a PDF, the connection drops halfway. A truncated file is left at `attachments/<blob>-<name>`. Every later tap returns that truncated file instantly with no download, and the viewer shows a corrupt document — permanently, until the user finds the "clear cache" button in settings.
- **Fix**: Decrypt to `dest.tmp`, verify the expected plaintext length, then atomically `renameTo(dest)`; delete the temp on any failure.

### [BROKEN] Older-message pagination silently stops on any error
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:106-113`
- **What**: `runCatching { MessageService.loadOlder(channelId) }` with no `onFailure`. Because `runCatching` catches `Throwable`, it also swallows `CancellationException`.
- **How it fails**: Scroll up on a flaky connection. The page fetch fails, nothing is shown, `loadingOlder` resets and the effect will not re-fire until `nearTop` or `messages.size` changes — which they won't, because nothing loaded. The reader is stuck at an arbitrary point in history with no indication anything went wrong and no way to retry. The web shows an explicit "Try again" button and retries with backoff plus an `online` listener (`web/src/components/chat/MessageList.tsx:337-343, 365`).
- **Fix**: Surface the failure with a retry affordance; count failures and back off; re-trigger on network return.

### [BROKEN] "Could not load messages" can show a coroutine-cancellation string
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:87-93, 121`
- **What**: `runCatching { MessageService.loadInitial(channelId) }.onFailure { failedLoad = it.message }`. `runCatching` catches `CancellationException`, so switching channels mid-load writes the cancellation's message into `failedLoad`.
- **How it fails**: Tap quickly between two channels. You can land on the empty state with the sub-text "StandaloneCoroutine was cancelled" or "Job was cancelled". Even without the cancellation case, showing the raw exception `message` is the wrong register for an end user.
- **Fix**: `catch (e: CancellationException) { throw e }` before the general handler, and map failures to a translated message.

### [BROKEN] Nothing ever sends "stopped typing"
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:300-304`
- **What**: The composer POSTs `/channels/{id}/typing` on a leading-edge 8 s throttle and never sends the stop. The web sends `sendTypingStop` when the box is cleared, when the channel changes and after a successful send (`web/src/components/composer/Composer.tsx:245-248, 155-158, 356-358`).
- **How it fails**: Start typing, then think better of it and clear the box. Everyone else sees "Alice is typing…" for the remaining ~9 seconds. Because the message send doesn't stop it either, a burst of short messages leaves a permanently-stuck indicator for the other party.
- **Fix**: Send the stop op on clear, on send and on channel change.
- **Also**: typing is sent over REST rather than the gateway. The web deliberately routes it over the socket and drops (never queues) typing frames while disconnected (`web/src/gateway/client.ts:218`); Android issues a full HTTPS round trip every 8 seconds of typing.

### [BROKEN] A failed read-receipt is never retried
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/MessageService.kt:294`
- **What**: `runCatching { MessagesApi.ack(channelId, messageId) }` — swallowed, no record kept. The web keeps an `unsent: Map<channelId, messageId>` of retryable failures and replays them on every `ready` (`web/src/stores/readStates.ts:34-85`).
- **How it fails**: Read a conversation on the phone while the connection is poor. Locally it shows as read; the server never hears about it, so the desktop and the web still show it unread, and the next `read_state` push from the server resets the phone's badge too. The user reads the same thing twice.
- **Fix**: Port the `unsent` map and replay on `ready`, classifying 5xx/429 as retryable and other 4xx as final.

### [BROKEN] The upload size gate is not reactive and rounds a missing limit to "nothing fits"
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:125`
- **What**: `AppState.instance.value?.maxUploadBytes ?: (100L * 1024 * 1024)` — the elvis only covers `null`, not `0`. Lines 158-159 in the same function correctly use `.takeIf { it > 0 } ?: default` for the other two limits, so the omission looks accidental. The web guards explicitly: `if (reported.max && reported.max > 0)` (`web/src/lib/attachments.ts:21`).
- **How it fails**: On an instance where `MAX_UPLOAD_BYTES` is set to 0, `Uploads.fits(size, 0)` is false for every file and the composer rejects everything with "… is larger than this server accepts." The stock server default is 104857600 (`internal/config/config.go:85`), so this needs a misconfigured instance to bite — **confirmed by reading the config default, not by running against a live server.**
- **Fix**: `.takeIf { it > 0 } ?: (100L * 1024 * 1024)`, matching the two lines below it.

### [BROKEN] Accept/decline/block on the friends screen fail silently
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/friends/FriendsScreen.kt:166, 169, 173, 176, 181-185`
- **What**: Every action is `scope.launch { runCatching { … } }` with no `onFailure`.
- **How it fails**: Tap the tick on an incoming friend request with no connectivity, or after the request has been withdrawn. Nothing happens at all — no spinner, no error, the row does not change. The user taps it repeatedly.
- **Fix**: `.onFailure { Session.toasts.emit(...) }` on each, and disable the buttons while in flight.

### [BROKEN] The back button loses your place
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/main/MainScreen.kt:62-68`
- **What**: `route !is Route.Chat -> Nav.go(Route.Chat(null, null))`. `Nav` (`ui/Nav.kt:31-57`) has no history stack at all.
- **How it fails**: You're reading `#general` in a server, you open Settings to change the theme, you press back — you land on the empty "No conversation open" screen with the drawer opening, not back in `#general`. Every trip into settings, server settings or a sticker pack costs you your position.
- **Fix**: Keep a small route stack in `Nav` and pop it on back.

---

### [BAD] Sticker and GIF sends fail silently
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:344-349, 359-368`
- **What**: `scope.launch { runCatching { MessageService.send(...) } }` with no failure path.
- **How it fails**: Pick a sticker with the key still missing (`WaitingForKey`) or offline. The picker closes, nothing appears in the channel, no toast. Note that `MessageService.send` *does* leave a `failed` optimistic row (`MessageService.kt:225-228`) — but for a sticker-only message `payload.text` is empty, so the row renders as nothing but "Not sent, tap to try again" with no visible content.
- **Fix**: Handle failures the way `doSend` does (toast), and render the sticker in the failed optimistic row.

### [BAD] Upload progress freezes after the first update
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:155-162`
- **What**: `for (item in files)` captures the original `Staged`; the progress callback does `staged.map { if (it === item) it.copy(progress = done) else it }`. The first callback replaces `item` with a copy, so from the second callback onwards no element is identity-equal to `item` and the list is unchanged.
- **How it fails**: Attach a 60 MB file and send. The spinner jumps to ~1% and sits there for the whole upload. The user assumes it has hung and cancels.
- **Fix**: Track by a stable id, not object identity.

### [BAD] An in-flight upload keeps a cancelled-scope toast and orphans the server session
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:147, 181-182`
- **What**: `doSend` runs on `rememberCoroutineScope()`. Navigating away from the chat cancels it mid-upload. The `catch (e: Exception)` catches the `CancellationException` and tries `Session.toasts.emit(...)` on a cancelled coroutine.
- **How it fails**: Start a large upload, hit back. `Uploads.inPieces`' catch does fire `UploadsApi.cancel` (`media/Uploads.kt:186`), but if the process is killed instead the session is orphaned server-side; and the in-composer error handling runs in an already-cancelled context so nothing is shown. There is also no way for the user to cancel an upload deliberately.
- **Fix**: Rethrow `CancellationException`; run uploads on a scope tied to the send, not the composable; add an explicit cancel affordance.

### [BAD] Decrypted attachments survive sign-out
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:354-363`, `android/app/src/main/java/xyz/evilion/chat/media/AttachmentStore.kt:76-78`
- **What**: `signOutLocally` clears `SecureStore`, `KeyService` and `AppState`, but `AttachmentStore.clear()` is only reachable from a button in settings (`ui/settings/SettingsScreen.kt:704`). `AppState`'s own doc comment claims "signing out leaves nothing behind".
- **How it fails**: Sign out on a shared or work phone. Up to 768 MB of **decrypted** photos, videos and documents from the previous account remain in `cacheDir/attachments`, readable by anything with the app's uid and included in any debug bundle or `adb backup`-style extraction.
- **Fix**: Call `AttachmentStore.clear()` (and Coil's disk cache clear) from `signOutLocally`.

### [BAD] Markdown inline parsing is quadratic
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/markdown/Parser.kt:173`
- **What**: `val rest = source.substring(i)` allocates a fresh string on **every character** of every inline run. With `MAX_SOURCE = 8000` (`Parser.kt:10`), one long message copies ~32 MB of chars.
- **How it fails**: A channel with a few long pasted messages (logs, code, an essay) makes the first scroll through them stutter and churns the GC. `Markdown.parse` is memoised per message text (`ui/chat/MessageRow.kt:136`) so it is once per message, not per frame — but it happens on the main thread during composition.
- **Fix**: Match against `source` with a start index (`Regex.find(source, i)` / `CharSequence` views) instead of substringing; or parse off the main thread.

### [BAD] Relative timestamps and system messages are hardcoded English
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/markdown/Render.kt:361-375`, `android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageRow.kt:325-329`
- **What**: `relative()` builds `"in 5 minutes"` / `"3 hours ago"` by string concatenation with English unit names and an `s` plural. `SystemMessage` builds `"$name joined."`, `"$name pinned a message."`, `"$name started a call."`, `"$name added someone to the group."`, `"$name left the group."`
- **How it fails**: The app ships ten languages (`i18n/Strings.kt:41-53`). Set it to Japanese and every `<t:…:R>` timestamp and every join/pin/call system line is in English, sitting between Japanese sentences.
- **Fix**: Route through `t()` with plural forms. Other hardcoded strings found: `ui/chat/ChatScreen.kt:280-281` ("is typing…"), `notify/Notifications.kt:124` ("is calling"), `ui/chat/MessageRow.kt:153` ("edited"), `ui/auth/AuthScreen.kt:168` ("6-digit code"), `ui/invite/InviteScreen.kt:84,91` ("a conversation", "member/members", "online"), `ui/chat/Composer.kt:132`, `media/Uploads.kt:157,169,183`.

### [BAD] Permission labels and emoji group names are frozen in the first language
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/Perms.kt:56-97`, `android/app/src/main/java/xyz/evilion/chat/ui/pickers/EmojiIndex.kt:24-34`
- **What**: `P.GROUPS` and `EmojiIndex.GROUPS` are `val`s on Kotlin `object`s, built by calling `t()` at class-initialisation time. `key(Strings.epoch)` (`MainActivity.kt:99`) rebuilds composables but cannot re-run a static initialiser.
- **How it fails**: Switch the app language in Settings. Everything rebuilds in the new language except the role and channel permission editor, which keeps every permission name and description in the old one, and the emoji picker's category headers.
- **Fix**: Make them functions (`fun groups(): List<…>`) evaluated per call, or rebuild them on `Strings.use`.

### [BAD] Dates in message timestamps ignore the chosen language in the markdown renderer
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/markdown/Render.kt:347-358`
- **What**: `DateFormat.getTimeInstance(...)` with no `Locale` argument uses the JVM default (the phone's locale). `MessageRow` does this correctly — `format()` and `longDate()` explicitly pass `Locale.forLanguageTag(Strings.tag)` (`ui/chat/MessageRow.kt:368-378`), with a comment saying exactly why.
- **How it fails**: An Arabic-reading user on an English phone gets Arabic month names in the day dividers and English ones inside `<t:…:D>` timestamps in the same message list.
- **Fix**: Pass `Locale.forLanguageTag(Strings.tag)` in `formatTimestamp`.

### [BAD] Swipe-to-reply launches a coroutine per pointer sample
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/SwipeToReply.kt:103`
- **What**: `scope.launch { offset.snapTo(clamped) }` inside the drag callback. `Animatable` serialises through a `MutatorMutex`, so each new `snapTo` **cancels** the previous one.
- **How it fails**: At 120 Hz the gesture produces ~120 competing coroutines per second, most of which are cancelled before they apply. The row lags behind the finger and stutters. The reply fires only after the spring-back animation completes (`:83-86`), adding another ~300 ms.
- **Fix**: Hold the offset in a plain `mutableFloatStateOf` for the drag and only use `Animatable` for the release animation; fire `onReply()` before animating home.

### [BAD] The typing bar recomposes once a second forever
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:269-276`
- **What**: `LaunchedEffect(typing) { while (true) { delay(1000); now.value = … } }` runs whether or not anyone is typing, and restarts whenever *any* channel's typing map changes. The web sweeps on a 2 s interval and returns the identical state object when nothing changed (`web/src/stores/typing.ts:25-38`).
- **How it fails**: A 1 Hz recomposition for the entire time a chat is open — visible in battery stats, and it keeps the CPU from idling.
- **Fix**: Only tick while `typing[channelId]` is non-empty; sweep the map in `AppState` and return the same instance when nothing expired.
- **Also**: `AppState.typing` entries for departed users are pruned only by an explicit stop or a new message; there is no sweep, so the map accumulates.

### [BAD] Audio players run forever, all at once, with no audio focus
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Players.kt:103-112, 115-127`
- **What**: `LaunchedEffect(player) { while (true) { …; delay(200) } }` never stops, even after playback ends. Nothing coordinates multiple players. There is no `AudioManager` focus request, and no pause on `onStop`.
- **How it fails**: Tap play on two voice messages — both play over each other. Start a video and press home — the audio keeps playing over whatever else you do. Neither ducks for a phone call.
- **Fix**: Stop the poll loop when `!isPlaying`; keep a single active player; request audio focus; pause on `ON_STOP` via `LocalLifecycleOwner`.

### [BAD] Attachment downloads are started on the session scope and never cancelled
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Players.kt:120-123`
- **What**: `Session.scope.launch { file = runCatching { AttachmentStore.file(meta) }.getOrNull() }` — a process-lifetime scope writing into composable state.
- **How it fails**: Tap play on a 300 MB audio file and immediately scroll away or leave the channel. The download continues to completion, burning mobile data for a file nobody is going to hear, and holds a reference to the disposed composable's state.
- **Fix**: `rememberCoroutineScope()`, so the download is cancelled with the row.

### [BAD] The captcha holds a reference to the Activity in a process-lifetime singleton
- **Where**: `android/app/src/main/java/xyz/evilion/chat/MainActivity.kt:70-74`, `android/app/src/main/java/xyz/evilion/chat/data/Captcha.kt:18-19`
- **What**: `Captcha.present` is assigned a lambda capturing `captchaRequest`, a field of `MainActivity`. It is never cleared in `onDestroy`.
- **How it fails**: (a) The `MainActivity` is leaked for as long as the process lives. (b) Worse, if the Activity is destroyed while a captcha is pending — process backgrounded and the task recreated — the new Activity installs a new lambda, but the login coroutine is still awaiting the *old* `CompletableDeferred`, which nobody will ever complete. Sign-in hangs on the spinner forever with no error.
- **Fix**: Clear `Captcha.present` in `onDestroy` when it is still this Activity's, and complete any outstanding deferred with `null` so the caller sees a cancellation.

### [BAD] The captcha WebView is never destroyed
- **Where**: `android/app/src/main/java/xyz/evilion/chat/MainActivity.kt:175-193`
- **What**: `AndroidView(factory = { WebView(context) … })` with no `onRelease`/`DisposableEffect` calling `destroy()`, and `addJavascriptInterface` on a page loaded over the network with `javaScriptEnabled = true`.
- **How it fails**: Each captcha leaks a WebView and its renderer bindings. The JS bridge, while it only completes a deferred, is exposed to whatever runs on `/native/captcha` — an XSS there could complete the challenge dialog. Worth reviewing the server-side page.
- **Fix**: `onRelease = { it.destroy() }`; scope the bridge as tightly as possible.

### [BAD] `saveJob` in the settings debouncer is written from two threads without synchronisation
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt:44, 96-102`
- **What**: `private var saveJob: Job?` — not `@Volatile`, not guarded. `scheduleSave()` is called from the main thread (every keystroke, via `setDraft`) and `flush()` runs on `Session.scope` (Default).
- **How it fails**: Two rapid `scheduleSave()` calls can each see a stale `saveJob`, so the cancel misses and two `PUT /users/@me/settings` go out concurrently with the *same* `version + 1`. One is rejected, and by the previous finding its change is lost silently.
- **Fix**: `@Synchronized` around `scheduleSave`, or a `Mutex`/`AtomicReference`.

### [BAD] Every keystroke in the composer rewrites and re-uploads the account-wide settings document
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:299` → `data/SettingsStore.kt:165-169, 81-84, 96-102`
- **What**: `setDraft` is called on every character. It copies the whole `drafts` object, replaces `_doc.value`, and arms a 600 ms timer that AES-encrypts the full settings document and PUTs it.
- **How it fails**: Typing a sentence issues a full encrypt + upload on every pause. `MainActivity` subscribes to `SettingsStore.doc` (`MainActivity.kt:82`), so every keystroke also invalidates the root composition scope and re-runs `Strings.use` (`:92`). On a slow link, drafts and real settings saves contend for the same version number, which is how the conflict in the DATA-LOSS finding gets triggered in ordinary use. The web has the same design but with an 800 ms debounce, dirty tracking and conflict retry that make it safe (`web/src/stores/settings.ts:274-288`).
- **Fix**: Debounce the local `_doc` write too (not just the network save), and land the dirty-tracking model before drafts share the document.

### [BAD] Settings can be saved before they have been loaded
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/SettingsStore.kt:104-111`, `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:342-347, 654`
- **What**: `goLive` sets `KeyService.identity` and `AuthStatus.READY` immediately; `SettingsStore.load(...)` only runs when the gateway `ready` arrives. In between, `key()` is non-null and `_doc.value` is `{}`. The web refuses outright: `if (!loaded) return` (`web/src/stores/settings.ts:221`), with a comment that it would otherwise overwrite the server with defaults.
- **How it fails**: Change anything — or type one character into a composer — in the window between sign-in and `ready`, and Android PUTs a near-empty settings document at `version = 1`. On an established account the server's higher version rejects it; on a fresh account, or if the versions happen to line up, the account's settings are wiped for every device.
- **Fix**: Add a `loaded` flag set by `load()`, and make `flush()` a no-op until it is set.

### [BAD] `KeyService.persist()` does blocking, whole-file encryption on the gateway event pump
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/KeyService.kt:53-61, 78-81` and `android/app/src/main/java/xyz/evilion/chat/data/SecureStore.kt:82-92`
- **What**: `ingestGrants` (called inline from `dispatch` for `key_grant`, `Session.kt:567-571`) calls `persist()`, which serialises every root key, AES-GCM-encrypts it with the Android keystore and writes the file — all synchronously, on a `Dispatchers.Default` thread, holding `SecureStore`'s monitor.
- **How it fails**: Joining a large server delivers a run of `key_grant` events. Each one stalls the entire event stream on a keystore round trip and a file write. With a hardware-backed keystore this is milliseconds each, but the events behind it — including voice signalling — wait.
- **Fix**: Move `persist()` onto `Dispatchers.IO` and coalesce it (debounce a few hundred ms).

### [BAD] Channels nested under a category you cannot see disappear from the sidebar
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/main/Sidebar.kt:152-210`
- **What**: `channels` is filtered by `VIEW_CHANNEL`; the tree is built from `byParent[null]` plus, for each visible category, `byParent[category.id]`. A channel whose `parentId` names a category the member cannot view appears in neither list. The web places such channels in a `loose` bucket that is always rendered (`web/src/stores/channels.ts:64-71`).
- **How it fails**: An admin denies `VIEW_CHANNEL` on a category but grants it on one channel inside — a common pattern. On Android that channel is simply absent from the drawer; the person can be mentioned in it and never find it.
- **Fix**: Render orphaned channels at the top level, as the web does.

### [BAD] Presence dots in the header, sidebar and self panel never update
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:212`, `android/app/src/main/java/xyz/evilion/chat/ui/main/Sidebar.kt:331, 358`, `android/app/src/main/java/xyz/evilion/chat/ui/sheets/ProfileSheet.kt:79`, `android/app/src/main/java/xyz/evilion/chat/ui/common/Common.kt:197-200`
- **What**: All read `AppState.presences.value[...]` rather than collecting the flow. `presenceOf` in `Common.kt` is a `@Composable` that reads `.value` and is therefore never invalidated.
- **How it fails**: A friend comes online. The DM list, the chat header avatar and your own status dot keep showing grey until something else forces a recompose.
- **Fix**: `collectAsState()`.

### [BAD] Opening an image whose message is no longer loaded shows a blank viewer
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/sheets/Misc.kt:78, 83, 127-135`
- **What**: `findAttachment` scans every message in every loaded channel to recover the `AttachmentMeta` (and its key) from a blob id. If it comes back null the viewer falls back to `Media.attachment(blobId)` — the **encrypted** bytes, which Coil cannot decode.
- **How it fails**: Open an image, background the app long enough that the channel's list is replaced, come back — black screen, no error, no download button (it is gated on `meta != null`). Separately, the linear scan runs on the main thread over every message in memory.
- **Fix**: Carry the `AttachmentMeta` in the `Layer.ImageViewer` payload instead of a blob id.

### [BAD] Layers in the overlay stack have no keys
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/sheets/Layers.kt:10-24`, `android/app/src/main/java/xyz/evilion/chat/ui/Nav.kt:51-53`
- **What**: `for (layer in layers) { when (layer) { … } }` identifies siblings by position. `Nav.popTo` removes by value equality with `filterNot { it == layer }`, which can remove from the middle and also removes **every** equal layer.
- **How it fails**: Open profile A, then from it profile B, then close A (via a stale callback) — B slides into slot 0 and inherits A's remembered state. Open the same profile twice and closing one closes both. Sheets briefly showing the wrong content is exactly the sort of thing that reads as "the app is broken".
- **Fix**: Wrap each in `key(layer)` and give each pushed layer a unique instance id.

### [BAD] User search fires a request per keystroke
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/sheets/Misc.kt:149-155`
- **What**: `LaunchedEffect(query) { if (query.length >= 2) runCatching { found = UsersApi.search(query) } }` — no debounce, failures swallowed.
- **How it fails**: Typing an eight-character username issues seven searches; responses can land out of order so the list shows results for a prefix. On a rate-limited instance the later, correct query is the one that gets the 429 — and nothing is shown.
- **Fix**: `delay(250)` at the top of the effect (cancellation gives you the debounce for free), and surface errors.

### [BAD] `bootstrap` failure in the offline retry loop wedges the app on "could not reach the server"
- **Where**: `android/app/src/main/java/xyz/evilion/chat/MainActivity.kt:204-209`
- **What**: `LaunchedEffect(Unit) { while (true) { delay(5000); Session.bootstrap() } }`. If `bootstrap` throws anything other than `ApiException` the loop's coroutine dies and never retries.
- **How it fails**: One malformed response and the screen is stuck on "Could not reach the server, trying again…" forever — with a message that is now a lie. The only fix is force-stopping the app.
- **Fix**: `runCatching` inside the loop (but rethrowing `CancellationException`), and show the underlying reason.

### [BAD] Raw exception text is shown to users in at least eight places
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/auth/AuthScreen.kt:107-109`, `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:182`, `android/app/src/main/java/xyz/evilion/chat/ui/friends/FriendsScreen.kt:127`, `android/app/src/main/java/xyz/evilion/chat/ui/invite/InviteScreen.kt:115`, `android/app/src/main/java/xyz/evilion/chat/ui/sheets/Misc.kt:202, 248, 299, 339`, `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:121`
- **What**: `error = e.message` / `toasts.emit(it.message ?: …)` on a plain `Exception`.
- **How it fails**: Instead of "That didn't work, check your connection", the user reads `Failed to connect to chat.evilion.xyz/104.21.…:443` or `Field 'token' is required for type with serial name …`. Server-authored `ApiException` messages are fine to show; everything else is not.
- **Fix**: Show `e.message` only when `e is ApiException`, and a translated fallback otherwise.

### [BAD] `REQUEST_INSTALL_PACKAGES` is declared but nothing uses it
- **Where**: `android/app/src/main/AndroidManifest.xml:21`
- **What**: The comment says "the app updates itself from this instance, the way the desktop app does", but grepping the whole source tree for `REQUEST_INSTALL`, `canRequestPackageInstalls`, `ACTION_INSTALL_PACKAGE` or `application/vnd.android.package-archive` finds nothing.
- **How it fails**: Users see "install unknown apps" in the permission list of a chat app, which is exactly the shape of a malicious app. Play Store review flags it and requires a declaration.
- **Fix**: Remove the permission until the updater exists.

### [BAD] Every ABI split shares one `versionCode`
- **Where**: `android/app/build.gradle.kts:56, 94-101`
- **What**: `versionCode = 2` with `splits.abi` producing four APKs (three ABIs plus universal) and no per-ABI version-code offset.
- **How it fails**: The download page cannot distinguish them by version, and neither can any future updater: an arm64 device that later receives the universal APK sees the same `versionCode` and there is no upgrade path between variants. The conventional fix is to add an ABI-indexed offset (e.g. `versionCode * 10 + abiIndex`).
- **Fix**: Set `output.versionCode` per ABI in an `onVariants` block.

---

### [POLISH] `Twemoji.reset()` exists for changing instance and is never called
- **Where**: `android/app/src/main/java/xyz/evilion/chat/media/Twemoji.kt:86-90`, `android/app/src/main/java/xyz/evilion/chat/ui/auth/AuthScreen.kt:313-317`
- **What**: The doc comment says "Forgets the list, for when the app is pointed at another instance", but the server-change path only sets `Api.baseUrl` and reloads the instance info. Neither Coil's disk cache nor the attachment cache is cleared either.
- **How it fails**: Point the app at a second instance; emoji artwork availability is judged by the first instance's index and cached pictures are served from the first instance's URLs (different base URL, so actually they just refetch — the stale index is the real effect: emoji the new instance ships are suppressed).
- **Fix**: Call `Twemoji.reset()` and clear the image caches on server change.

### [POLISH] `AppState.waitingForKeys` is written in five places and read nowhere
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/AppState.kt:74`, written at `Session.kt:395`, `KeyService.kt:80,104,147,162`, `MessageService.kt:152`
- **What**: No UI subscribes to it. The per-message "waiting for the key" state comes from `UiMessage.decryptError` instead (`ui/chat/MessageRow.kt:132`).
- **Fix**: Either surface it (a channel-level "waiting for the key to this conversation" banner, as the web has) or remove it.

### [POLISH] `messageFlows` grows for the life of the process
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/AppState.kt:76-83`
- **What**: `getOrPut` per channel, removed only by `removeChannel`, `removeServer` and `reset`. No cap on messages per channel either.
- **How it fails**: Browse thirty channels over an hour and every page of every one is still in memory, decrypted. The web at least drops non-active channels on each `ready` (`web/src/stores/messages.ts:279-286`).
- **Fix**: Evict channels not visited recently, and cap retained messages per channel.

### [POLISH] `AttachmentStore.locks` grows without bound
- **Where**: `android/app/src/main/java/xyz/evilion/chat/media/AttachmentStore.kt:28, 48`
- **What**: One `Mutex` per blob id, never removed. Same pattern in `KeyService.convLocks` (`data/KeyService.kt:38, 93`).
- **Fix**: Remove the entry once the last waiter is done, or use a size-bounded map.

### [POLISH] No `rememberSaveable` anywhere in the app
- **Where**: whole tree — `grep -rn rememberSaveable` returns nothing
- **What**: `android:configChanges` (`AndroidManifest.xml:52`) covers rotation, so this is not a rotation bug. It is a process-death bug.
- **How it fails**: Type a username and password, get interrupted by a call, come back — the fields are empty. Half-composed replies, the invite preview, picker state and the current `Nav.route` are all gone. Drafts survive because they go through `SettingsStore`.
- **Fix**: `rememberSaveable` for the auth form fields, `replyTo`/`editing` ids and the route.

### [POLISH] A new recovery key exists only in memory until it is acknowledged
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:86, 240, 280`
- **What**: `pendingRecoveryKey` is a `MutableStateFlow<String?>`.
- **How it fails**: Register, then background the app before tapping "I have written it down". Android kills the process; the recovery key is gone and there is no way to see it again short of generating a new one — and if the password is later forgotten before that happens, every message on the account is unrecoverable. The consequences justify persisting it (encrypted, in `SecureStore`) until acknowledged.
- **Fix**: Persist to `SecureStore` on creation, clear on acknowledgement.

### [POLISH] `MdContext.nameOfUser` compares against the English word "Unknown"
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/MessageRow.kt:204`
- **What**: `AppState.nameFor(id, serverId).takeIf { it != "Unknown" }`; `nameFor` returns `t("modals.quickSwitcher.unknown")` (`data/AppState.kt:185`).
- **How it fails**: In any non-English language the comparison never matches, so a mention of an unknown user renders as `@Desconocido` rather than falling through to the renderer's own `@unknown` (`ui/markdown/Render.kt:270`). Cosmetic, but it is a latent locale-coupled comparison.
- **Fix**: Have `nameFor` return `null` for unknown and let callers choose the wording.

### [POLISH] `AppState.dmChannels()` sorts a snowflake against a millisecond timestamp
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/AppState.kt:175-176`
- **What**: `sortedByDescending { it.lastMessageId?.toLongOrNull() ?: it.createdAt }` mixes two number spaces. The web uses `compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id)` (`web/src/stores/channels.ts:74-79`) — id against id.
- **How it fails**: Benign today (snowflakes are ~10^18, timestamps ~10^12, so empty DMs sort to the bottom, which happens to be right), but it breaks the moment id generation changes.
- **Fix**: Fall back to `it.id.toLongOrNull()`.

### [POLISH] Channel ordering compares ids as strings
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/AppState.kt:170-173`
- **What**: `compareBy({ isCategory }, { position }, { it.id })` compares `id` lexicographically. The web's `compareIds` is length-then-lexicographic (`web/src/lib/ids.ts:4-8`) precisely because decimal snowflakes of different digit counts sort wrongly as strings.
- **How it fails**: Only when two channels share a `position` and their ids differ in length — an instance that has been running long enough to cross a digit boundary. Rare but real.
- **Fix**: Port `compareIds`.

### [POLISH] `MentionSuggestions` recompiles a regex and re-derives its pool on every keystroke
- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:381, 383`
- **What**: `Regex("(?:^|\\s)@([a-zA-Z0-9_.]{0,32})$")` is constructed inside the composable body; `remember(query, users.size, serverId)` misses changes to `users` that keep the size constant.
- **Fix**: Hoist the regex to a file-level `private val`; key the `remember` on the map itself.

### [POLISH] `SecureStore.read()`/`write()` do file and keystore I/O on whatever thread calls them
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/SecureStore.kt:59-92`
- **What**: `@Synchronized`, blocking, called from `Session.bootstrap` (`Session.kt:109-112`) — which runs from a `LaunchedEffect` whose default dispatcher is the composition's (main) dispatcher until `UsersApi.me()` switches away.
- **How it fails**: The keystore unwrap on the first read happens on the main thread, which on a cold start with a hardware keystore is a measurable slice of the first frame. StrictMode's `detectDiskReads` would flag it.
- **Fix**: `withContext(Dispatchers.IO)` around the first read in `bootstrap`.

### [POLISH] `CrashReport.sendPending` deletes the report before it is sent
- **Where**: `android/app/src/main/java/xyz/evilion/chat/data/CrashReport.kt:56-57`
- **What**: `file.delete()` happens immediately after reading, before the upload is attempted.
- **How it fails**: The crash that matters most — the one that happens when the phone has no connectivity at launch — is the one that never gets reported.
- **Fix**: Delete only after a successful POST.

### [POLISH] The upload progress callback reports bytes handed to OkHttp, not bytes accepted
- **Where**: `android/app/src/main/java/xyz/evilion/chat/net/ApiClient.kt:153-166`
- **What**: `writeTo` reports after `sink.write`, which is buffered.
- **How it fails**: On a fast local write and a slow uplink the bar hits 100 % and then sits there for the remainder of the transfer. Cosmetic, but it is the difference between "uploading" and "hung".
- **Fix**: Flush the sink per step, or scale the reported fraction.

---

## Config notes checked and found correct

Recording these so they are not re-investigated:

- `PendingIntent` mutability: every `PendingIntent` uses `FLAG_IMMUTABLE` (`notify/Notifications.kt:60, 112, 120`; `service/Services.kt:40, 88`) — correct for `targetSdk` 31+.
- Exported components: only `MainActivity` is exported; both services and the `NotificationActions` receiver are `exported="false"` (`AndroidManifest.xml:84, 89, 91`).
- `FileProvider`: authority `${applicationId}.files` matches the runtime `"${context.packageName}.files"` in both build types (the debug `applicationIdSuffix` applies to both), and `file_paths.xml` includes `cache-path .` which covers `cacheDir/attachments`. `FLAG_GRANT_READ_URI_PERMISSION` is set (`ui/chat/AttachmentViews.kt:207-212`).
- Foreground-service starts are wrapped: `startForegroundService` in `runCatching` (`service/Services.kt:58, 111`) and `startForeground` in a `try` that returns a boolean (`service/Services.kt:134-141`), so a `ForegroundServiceStartNotAllowedException` under `targetSdk` 37 degrades instead of crashing. The microphone-type guard at `Services.kt:96-98` is correct and deliberately fails open.
- `KeyRing` uses `ConcurrentHashMap` throughout (`crypto/Conv.kt:29-30`), so concurrent `set`/`get` from the event pump and the send path is safe.
- Nothing sensitive is logged: every `Log.*` call in the app was reviewed — no keys, tokens, plaintext or passwords (`data/Session.kt:97`, `net/Gateway.kt:154,172`, `data/SecureStore.kt:74,91`, `data/KeyService.kt:166`, `media/AttachmentStore.kt:73`, `service/Services.kt:139`).
- `network_security_config.xml` permits cleartext only for `127.0.0.1`, `localhost` and `10.0.2.2` — correct.
- `data_extraction_rules.xml` excludes everything from cloud backup and device transfer, and `allowBackup="false"` — correct given `secure.bin` holds the identity key.
- The kotlinx.serialization ProGuard rules (`proguard-rules.pro:13-20`) match the canonical set from the library's README (`$$serializer` keep with `includedescriptorclasses`, `Companion` members, `serializer(...)` classes); WebRTC, argon2kt and the BouncyCastle X25519 path are kept. **I did not build the release variant**, so this is a read of the rules rather than a verification. The two things I would check by building `assembleRelease` and running it: that `@JavascriptInterface` methods survive (AGP's `proguard-android-optimize.txt` normally keeps them, but the captcha bridge is the one reflective surface written by hand), and that `Api.request<T>`'s reified `serializer<T>()` resolves for generic types like `List<Message>` — adding `-keepattributes Signature` would be the cheap insurance.
