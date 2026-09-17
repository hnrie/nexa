# Android UI and UX

## Summary

The Android client has the right bones — a shared design-token palette, a
generated lucide icon set, the web client's own translation catalogue — but the
screens on top of them were assembled without the checks a phone needs. Three
classes of problem dominate. First, **layouts are written for one phone width**:
the chat header packs six 48 dp icon buttons beside a `weight(1f)` title, so on a
360 dp screen the channel name gets about 40 dp; the call control row needs
312 dp of buttons in 288 dp of space, so the hang-up button walks off a small
screen. Second, **the expression surface is three unrelated bottom sheets**
rather than the web client's one tabbed picker, and the single button that opens
stickers and GIFs is replaced by Send the moment you type a character, which
makes stickers and GIFs unreachable from a non-empty composer. Third, **a lot of
UI is wired to nothing**: Ash and Onyx are offered in Appearance and both render
as Dark, four more Appearance toggles read a setting no screen consumes, "Mark
unread" calls an endpoint that the server refuses to move backwards, guest-call
links open a plain server invite, and search results and pinned messages are not
tappable.

Underneath that sit a consistent set of smaller faults: window insets applied
twice in some places and not at all in others (the composer floats a nav-bar's
height above the open keyboard); every bottom sheet is yanked out of the tree
instead of animated away; nothing wraps, so reactions, role chips and the
Friends tabs clip at the screen edge; the light theme draws code blocks and
embeds in exactly the background colour; and RTL was handled at the layout
direction but not in the one place that hardcodes pixels — swipe-to-reply is
backwards in Arabic. Compared with `web/src/components/`, the phone is missing
context menus entirely, the quick switcher, the unread divider, drag-reorder,
skin tones, GIF favourites, slash commands and client-side link previews.

Counts: 74 findings — 15 BROKEN, 33 BAD, 18 POLISH, 8 IDEA.

---

## Findings

### [BROKEN] Stickers and GIFs become unreachable as soon as you type

- **Where**: `android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:312-324`
- **What**: The composer has two trailing buttons. The emoji button is always
  present (`Composer.kt:312`). The second slot is conditional: `if
  (value.text.isBlank() && staged.isEmpty())` it is the sticker/GIF button
  (`Composer.kt:316-318`), `else` it becomes the Send button
  (`Composer.kt:320-323`). There is no other entry point to
  `GifPickerSheet` or `StickerPickerSheet` anywhere in the app.
- **Why it matters**: Type one character and the only door to stickers and GIFs
  disappears. You cannot send "look at this" with a GIF; you must clear the box,
  send the GIF as its own message, then retype. The same button also silently
  changes meaning under the thumb as you type, so muscle memory sends a message
  when you meant to open stickers.
- **Fix**: Keep one persistent expression button (the web uses exactly one,
  `web/src/components/composer/Composer.tsx:503`, a `Smile` icon that opens the
  tabbed picker) and add the Send button as a third control rather than a
  replacement. Web already does this — its send button is mobile-only and lives
  beside the emoji button (`Composer.tsx:504`).

### [BROKEN] The expression picker is three disconnected sheets, not one

- **Where**: `ui/pickers/Pickers.kt:62` (`EmojiPickerSheet`), `:204`
  (`GifPickerSheet`), `:265` (`StickerPickerSheet`); dispatch at
  `ui/chat/Composer.kt:328-371`
- **What**: Three separate `ModalBottomSheet`s. `EmojiPickerSheet` has no link
  to the other two. `GifPickerSheet` has a single text link "Stickers"
  (`Pickers.kt:226-231`) that swaps `picker = "sticker"`. `StickerPickerSheet`
  has no way back to GIFs or emoji. There is no tab bar. The `t()` key
  `pickers.expressionPicker.stickers` used at `Pickers.kt:227` is the web's *tab
  label*, which is the fossil of the tabbed picker that was never ported.
- **Why it matters**: This is the owner's complaint verbatim. The web client is
  one popover with a tab strip — GIFs / Stickers / Emoji / close —
  (`web/src/components/pickers/ExpressionPicker.tsx:87-92`) and the three panels
  are slotted into it (`ExpressionPicker.tsx:14-15, 93`). On Android, moving from
  emoji to stickers means dismissing a sheet, finding a different button, and
  hoping you land on the GIF tab so you can follow the one-way text link.
- **Fix**: Port `ExpressionPicker` as a single `ModalBottomSheet` holding a
  `TabRow` (`gif | sticker | emoji`, defaulting to emoji as web does at
  `ExpressionPicker.tsx:53`) with the three existing panels as its pages. Delete
  the `onOpenStickers` hack.

### [BROKEN] Ash and Onyx are offered and do nothing

- **Where**: `ui/settings/SettingsScreen.kt:329`; `MainActivity.kt:83-87`;
  `ui/theme/Theme.kt:74, 121, 191`
- **What**: Appearance lists five themes — dark, light, **ash**, **onyx**,
  system (`SettingsScreen.kt:329`). `MainActivity` resolves them with
  `when (SettingsStore.theme) { "light" -> false; "system" -> isSystemInDarkTheme(); else -> true }`
  (`MainActivity.kt:83-87`), and `NexaTheme` only has two palettes,
  `DarkColors` and `LightColors` (`Theme.kt:191`). Ash and Onyx both fall into
  `else -> true` and render as Dark. The radio dot still moves
  (`SettingsScreen.kt:336` compares `SettingsStore.theme == id`), so it looks
  like it worked.
- **Why it matters**: Two of five themes are decorative. Worse, the setting is
  synced to the account, so choosing Onyx on the phone silently changes the
  web client's theme (web has real Ash and Onyx token sets at
  `web/src/styles/tokens.css:170` and `:186`) while the phone keeps showing Dark.
- **Fix**: Add `AshColors` and `OnyxColors` to `Theme.kt` transcribed from
  `tokens.css:170-200`, and replace the boolean `dark` with a
  `ChatColors`-returning resolver.

### [BROKEN] The chat header crushes the channel name on a normal phone

- **Where**: `ui/chat/ChatScreen.kt:203-259`
- **What**: One fixed-height `Row` holds up to six Material3 `IconButton`s —
  menu (`:207`), phone (`:241`), video (`:244`), pin (`:248`), search (`:251`),
  members (`:255`) — plus a 20 dp channel icon and a 4 dp spacer, with the title
  `Column` on `weight(1f)` (`:221`). `IconButton` enforces a 48 dp minimum touch
  target, so the icons alone take 288 dp. On a 360 dp-wide phone, after the 8 dp
  of row padding the title column gets roughly 40 dp.
- **Why it matters**: The channel name — the single most important label on the
  screen — ellipsises to two or three characters, and the topic line beneath it
  (`:230-238`) shows nothing at all. On a 411 dp Pixel it is still only ~90 dp.
- **Fix**: Keep menu + title + one call button + an overflow `Ellipsis` menu, as
  the web sidebar/header split does; move pin, search and members into the
  overflow. Give the title `Modifier.weight(1f, fill = false)` and set a
  `widthIn(min = 120.dp)` floor on it.

### [BROKEN] The call button row overflows a narrow phone; hang-up is unreachable

- **Where**: `ui/voice/CallScreen.kt:237-286`, buttons sized at `:303`
- **What**: Six `CallButton`s at `Modifier.size(52.dp)` (`:303`) in a plain
  `Row` with `Arrangement.SpaceEvenly` and `padding(horizontal = 16.dp)`
  (`:238-239`). That is 312 dp of children. A 360 dp phone leaves 328 dp, so the
  seven gaps get about 2 dp each; a 320 dp phone leaves 288 dp, so
  `SpaceEvenly` computes a negative gap and the children run past the edge. The
  hang-up button is last (`:281`).
- **Why it matters**: On a small phone you cannot end the call. Even on a
  mainstream phone six 52 dp circles butt against each other with no breathing
  room, which is a large part of why the call screen reads as broken.
- **Fix**: Wrap the controls in a `FlowRow` (or a two-row layout: mic / deafen /
  camera on top, screen / speaker / hang-up beneath), drop the buttons to 48 dp,
  and give hang-up its own emphasised position rather than one of six equals.

### [BROKEN] Two call screens can be stacked on top of each other

- **Where**: `ui/Nav.kt:43-45`; pushed from `ui/chat/ChatScreen.kt:241, 244` and
  `ui/main/Sidebar.kt:230`; rendered at `ui/sheets/Layers.kt:10-24`
- **What**: `Nav.push` appends unconditionally with no de-duplication
  (`Nav.kt:43-45`). `Layer.Call(channelId)` and `Layer.Call(channelId, video = true)`
  are different values, so tapping the phone icon and then the video icon puts
  two `Layer.Call` entries in the list, and `AppLayers` renders every entry
  (`Layers.kt:11-23`). Tapping the same button twice does the same. Each
  `CallScreen` is a full-screen `Dialog` (`CallScreen.kt:143`) that runs its own
  `LaunchedEffect(channelId)` calling `VoiceSession.join` and
  `CallService.start` (`CallScreen.kt:113-126`).
- **Why it matters**: Two opaque full-screen dialogs with two sets of WebRTC
  renderers over the same call; the foreground service is started twice; closing
  one leaves the other. This is a plausible source of the owner's "calls crashed
  the client".
- **Fix**: Make `Nav.push` a no-op when a layer of the same *type* is already on
  the stack (or at minimum when `Layer.Call` with the same `channelId` is), and
  make `Layer.Call` equality ignore `video`.

### [BROKEN] `VideoView` releases a live renderer and never attaches a changed track

- **Where**: `ui/voice/CallScreen.kt:325-349`
- **What**: `AndroidView`'s `factory` captures `track` and attaches the sink once
  (`:333`); there is no `update` block. `DisposableEffect(track)` releases the
  renderer when the track changes (`:340-348`), but the `AndroidView` node
  survives and its factory is not re-run, so `renderer.value` is left null and
  the released `SurfaceViewRenderer` stays in the hierarchy. The
  `remember(track) { mutableStateOfRenderer() }` on `:326` also hands the effect
  a fresh, empty state holder on the *new* track while the old holder still
  owns the view.
- **Why it matters**: A peer turning their camera on/off, or switching between
  camera and screen share, flips `peer?.screen ?: peer?.video` (`:183`). The
  tile then goes permanently black, and frames delivered to a released native
  renderer are a native crash.
- **Fix**: Keep the renderer in `remember { mutableStateOf<SurfaceViewRenderer?>(null) }`
  keyed on nothing, create it in `factory`, and swap sinks in
  `AndroidView(update = { view -> old?.removeSink(view); track.addSink(view) })`.
  Release only in a `DisposableEffect(Unit)` `onDispose`.

### [BROKEN] Attaching the same file twice crashes the composer

- **Where**: `ui/chat/Composer.kt:123-139` and `:226`
- **What**: Picked files are appended with no de-duplication
  (`staged = staged + picked`, `:138`) and the attachment strip keys its
  `LazyRow` items on the URI: `items(staged.size, key = { staged[it].file.uri.toString() })`
  (`:226`).
- **Why it matters**: Pick a photo, then open the picker again and pick the same
  photo (easy — the system picker does not show what is already staged). Lazy
  layouts throw `IllegalArgumentException: Key "..." was already used` and the
  app dies with the message half-composed.
- **Fix**: `staged = (staged + picked).distinctBy { it.file.uri }`, and cap the
  count — the web caps at 10 (`web/src/components/composer/Composer.tsx:306`).

### [BROKEN] Guest-call links open a plain server invite

- **Where**: `ui/main/MainScreen.kt:102`; `ui/invite/InviteScreen.kt:48`
- **What**: `Route.GuestCall` renders `InviteScreen(current.code, guest = true)`
  (`MainScreen.kt:102`). `InviteScreen` declares the parameter
  (`InviteScreen.kt:48`) and never reads it — the body has no reference to
  `guest` at all. The screen fetches `ServersApi.invitePreview(code)`
  (`:56`) and shows an "Accept invite" button (`:100-122`).
- **Why it matters**: `https://chat.evilion.xyz/guest/<code>` is registered as a
  deep link (`AndroidManifest.xml`, `pathPrefix="/guest/"`). Someone tapping a
  guest call link gets an invite-preview page which will most likely fail with
  "This invite is not valid any more" (`:57`), and can never join the call.
- **Fix**: Either implement a guest-call branch (preview the call, one "Join"
  button that pushes `Layer.Call`) or delete the `/guest/` intent filter and the
  `Route.GuestCall` case so the link opens the browser instead.

### [BROKEN] "Mark unread" does nothing

- **Where**: `ui/chat/MessageActions.kt:117-127`; endpoint at
  `net/Endpoints.kt:166`
- **What**: The action finds the message before the target and calls
  `MessagesApi.ack(channelId, previous?.raw?.id ?: "0")`. `Endpoints.kt:166`
  sends `POST /channels/{id}/messages/{id}/ack` with **no body**. The web client
  documents the server's rule in a comment: *"The regular ack never moves
  backwards; 'mark unread' needs the manual flag"*, and sends
  `{ manual: true }` (`web/src/components/chat/messageMenu.ts:108-112, 125`).
- **Why it matters**: The action appears in the long-press sheet, dismisses the
  sheet, and silently changes nothing. There is no error and no local optimistic
  update either (web sets the read state locally at `messageMenu.ts:122`).
- **Fix**: Add a `manual` body parameter to `MessagesApi.ack`, send it from the
  mark-unread path, and update `AppState.readStates` optimistically.

### [BROKEN] From the empty chat state there is no way to open the channel list

- **Where**: `ui/main/MainScreen.kt:84-96`, `:62-68`
- **What**: When `channelId == null` the app draws a bare `EmptyState`
  (`:88-92`) and opens the drawer once via `LaunchedEffect(Unit)` (`:93`). That
  branch renders **no header and no menu button**. The `BackHandler` is disabled
  in this state (`:62`: `layers.isNotEmpty() || route !is Route.Chat || drawer.isOpen`
  are all false), so back quits the app.
- **Why it matters**: Close the drawer — a tap outside it, or a back press — and
  you are staring at "No conversation open / Pick one from the list" with no
  control that opens the list. The only recovery is a left-edge swipe, which on
  a gesture-navigation phone competes with the system back gesture, or killing
  the app.
- **Fix**: Give the empty branch the same `ChatHeader` bar (or at least a
  hamburger `IconButton`), and make the `EmptyState` message's "the list" a
  button that calls `drawer.open()`.

### [BROKEN] In the light theme code blocks and embeds are invisible

- **Where**: `ui/theme/Theme.kt:122, 163, 164`; consumers at
  `ui/markdown/Render.kt:127` (block code), `:234-238` (inline code) and
  `ui/chat/AttachmentViews.kt:236` (embeds)
- **What**: `LightColors.bgBase = Color(0xFFF3F3F4)` (`:122`),
  `LightColors.codeBg = Color(0xFFF3F3F4)` (`:163`) and
  `LightColors.embedBg = Color(0xFFF3F3F4)` (`:164`) are the *same colour*. The
  chat list is drawn on `bgBase` (`ui/chat/ChatScreen.kt:115`), so a code block
  drawn with `colors.codeBg` and an embed drawn with `colors.embedBg` have zero
  contrast with what is behind them.
- **Why it matters**: In the Light theme, fenced code, inline code and every
  link embed lose all their boundaries — the code text just floats in the
  message, and an embed is nothing but a 4 dp accent bar with loose text beside
  it.
- **Fix**: Set `codeBg` and `embedBg` to `0xFFFFFFFF` or `0xFFE8E9EB` in
  `LightColors`, matching the web's light tokens
  (`web/src/styles/tokens.css:81`).

### [BROKEN] Four Appearance settings are wired to nothing

- **Where**: `ui/settings/SettingsScreen.kt:372-377`; storage at
  `data/SettingsStore.kt:138, 140, 142, 144, 146`
- **What**: Compact mode, Show link previews, Show images and Reduce motion are
  toggles that write `messageDisplay`, `linkPreviews`, `imagePreviews` and
  `reducedMotion`. A repo-wide search shows those five properties (`fontScale`
  too) have **no reader outside `SettingsStore.kt` and `SettingsScreen.kt`**.
  `MessageRow` never checks `messageDisplay`; `AttachmentViews`/`EmbedList`
  never check `imagePreviews`/`linkPreviews`; Coil's `crossfade(true)`
  (`media/CoilSetup.kt:60`) and `SwipeToReply`'s animations ignore
  `reducedMotion`.
- **Why it matters**: Four switches that flip and do nothing, and because the
  document is account-synced they change the *web* client's behaviour while the
  phone stays the same. `reducedMotion` failing is an accessibility problem, not
  a cosmetic one.
- **Fix**: Honour them — `messageDisplay == "compact"` collapses the avatar
  gutter in `MessageRow`; `imagePreviews`/`linkPreviews` gate `ImageAttachment`
  and `EmbedList`; `reducedMotion` disables the Coil crossfade and shortens the
  swipe-to-reply `animateTo`. Or hide the rows until they work.

### [BROKEN] Search results and pinned messages are not tappable

- **Where**: `ui/sheets/ChannelSheets.kt:235` (search), `:164-188` (pins)
- **What**: A search result row is
  `Modifier.fillMaxWidth().clickable { onDismiss() }` (`:235`) — the whole
  gesture is "close the sheet". A pinned-message row (`:167`) has no
  `clickable` at all.
- **Why it matters**: You can find a message and you cannot go to it. The web
  jumps to the message and flashes it for two seconds
  (`web/src/components/chat/MessageList.tsx:254-277`), and the quick switcher's
  message mode does the same.
- **Fix**: Add a `jumpTo(messageId)` to `MessageService`/`ChatScreen` (load
  around the id if it is not in memory, `animateScrollToItem`, then a brief
  highlight) and call it from both sheets before dismissing.

### [BROKEN] A message that fails to send can never be removed

- **Where**: `ui/chat/MessageRow.kt:160-177`; unused API at
  `data/MessageService.kt:246`
- **What**: A failed message renders "Not sent, tap to try again" which calls
  `MessageService.retry` (`MessageRow.kt:171-173`). `MessageService.dropFailed`
  exists (`MessageService.kt:246`) and is called from nowhere in the app.
- **Why it matters**: If the send keeps failing — no permission, too long, the
  server rejected it — the ghost message sits at the bottom of the conversation
  forever, with the only affordance being to fail again. The web offers Retry
  *and* Delete side by side
  (`web/src/components/chat/MessageItem.tsx:214-220`).
- **Fix**: Add a "Discard" control beside the retry text (and/or a
  `Trash2` row in the long-press sheet when `message.failed`) calling
  `dropFailed`.

---

### [BAD] The composer floats a nav-bar's height above the open keyboard

- **Where**: `ui/chat/ChatScreen.kt:115` and `:177`
- **What**: The root column applies `.imePadding()` (`:115`) and the composer
  additionally applies `.navigationBarsPadding()` (`:177`).
  `Modifier.windowInsetsPadding` only consumes the inset *it* applied, so
  consuming the IME inset does not consume the navigation-bar inset; the
  composer still pads for a nav bar that the keyboard is currently covering.
- **Why it matters**: Open the keyboard and there is a ~48 dp empty band between
  the input pill and the top of the keyboard, on every message you type. It is
  the most-looked-at part of the app.
- **Fix**: Apply one padding for both:
  `Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))`
  on the composer, and drop `.imePadding()` from the root column.

### [BAD] Window insets are handled three different ways across bottom sheets

- **Where**: with `navigationBarsPadding()` — `ui/sheets/ChannelSheets.kt:106,
  155, 209, 271, 370`, `ui/sheets/Misc.kt:161, 226`,
  `ui/sheets/ProfileSheet.kt:87`, `ui/chat/MessageActions.kt:83`; **without** —
  `ui/pickers/Pickers.kt:77, 222, 273`
- **What**: `ModalBottomSheet` already applies
  `BottomSheetDefaults.windowInsets` (vertical system bars) to its content, and
  none of these call sites overrides it. Eight sheets then add
  `navigationBarsPadding()` on top of that, and the three expression pickers add
  nothing.
- **Why it matters**: Sibling sheets have visibly different bottom gaps — the
  member list and profile card sit a nav-bar too high, and the emoji, sticker
  and GIF grids run their last row under the gesture bar, where taps land on the
  system instead of on an emoji.
- **Fix**: Pick one rule. Remove every `navigationBarsPadding()` inside a
  `ModalBottomSheet` and rely on the component's own insets, or pass
  `contentWindowInsets = { WindowInsets(0) }` everywhere and pad by hand.
  Whichever — make the three pickers match the other eight.

### [BAD] Every bottom sheet is yanked out of the tree instead of animated away

- **Where**: `ui/sheets/Layers.kt:12-23`; every `onDismissRequest = onDismiss`
  at `ui/sheets/ChannelSheets.kt:105, 154, 208, 270, 369`,
  `ui/sheets/Misc.kt:160, 225`, `ui/sheets/ProfileSheet.kt:86`,
  `ui/chat/MessageActions.kt:82`, `ui/pickers/Pickers.kt:76, 221, 272`
- **What**: `onDismissRequest` goes straight to `Nav.popTo(layer)`
  (`Layers.kt:13-23`), which removes the layer from the state list and therefore
  removes the `ModalBottomSheet` from composition on the same frame. Material3's
  documented pattern is `scope.launch { sheetState.hide() }.invokeOnCompletion { remove() }`.
- **Why it matters**: Twelve sheets all vanish instantly with no slide-down and
  no scrim fade, while they slide *in* normally. The asymmetry is exactly the
  kind of thing that reads as "scuffed".
- **Fix**: Add one `rememberDismissible(sheetState, onDone)` helper and route
  every `onDismissRequest` through it.

### [BAD] Sheets are a hardcoded height, so they overflow small and short screens

- **Where**: `ui/sheets/ChannelSheets.kt:106, 155, 209` (520 dp),
  `ui/sheets/Misc.kt:161` (520 dp), `ui/pickers/Pickers.kt:77, 222, 273` (460 dp)
- **What**: Each sheet's content is `Column(Modifier.fillMaxWidth().height(520.dp))`
  or `.height(460.dp)` — a fixed number, not a fraction and not `heightIn`.
- **Why it matters**: On a compact phone (≈ 640 dp usable) a 520 dp sheet plus
  the drag handle plus insets is essentially full screen but does not look like
  it meant to be. In landscape, or on a small phone, the fixed height exceeds the
  window and the content below is simply cut off with no scroll — the
  `NewMessageSheet`'s "Start conversation" button (`Misc.kt:194-208`) becomes
  unreachable.
- **Fix**: `heightIn(max = 520.dp).fillMaxHeight(0.85f)` or drive the height from
  `LocalConfiguration`, and make the pickers `fillMaxHeight(0.6f)` the way the
  web's phone bottom-sheet does (`web/src/components/pickers/Picker.module.css:37`).

### [BAD] Nothing wraps: reactions, role chips and the Friends tabs clip

- **Where**: `ui/chat/MessageRow.kt:279-283`, `ui/sheets/ProfileSheet.kt:133-134`,
  `ui/friends/FriendsScreen.kt:78-101`, `ui/voice/CallScreen.kt:237`
- **What**: There is no `FlowRow` anywhere in the module. Reactions are a plain
  `Row` taking up to 12 pills (`MessageRow.kt:283`); a profile shows up to 6
  role chips in a plain `Row` (`ProfileSheet.kt:134`); the Friends screen puts
  four tab chips in a non-scrolling `Row` (`FriendsScreen.kt:78-81`).
- **Why it matters**: Four or five reactions already run off the right edge of a
  360 dp phone and the rest are unreachable — you cannot even see, let alone
  tap, the sixth reaction. Role chips do the same. In German or Russian the
  four Friends tabs ("Ausstehend", "Blockiert") overflow and the last one is
  clipped, so there is no way to reach the blocked list. The web wraps its
  reactions (`web/src/components/chat/Chat.module.css:98-102`).
- **Fix**: `androidx.compose.foundation.layout.FlowRow` for reactions and role
  chips; `Modifier.horizontalScroll(rememberScrollState())` or a `ScrollableTabRow`
  for the Friends tabs.

### [BAD] Swipe-to-reply is backwards in Arabic

- **Where**: `ui/chat/SwipeToReply.kt:66, 77, 95-96`
- **What**: The reply icon sits at `padding(start = 14.dp)` with
  `Alignment.CenterStart` (`:66`) — both RTL-aware, so in Arabic it moves to the
  right edge. The row itself moves with
  `Modifier.offset { IntOffset(offset.value.roundToInt(), 0) }` (`:77`), the
  *lambda* overload, which is **not** RTL-aware and always moves in raw +x, and
  the drag is clamped to `coerceIn(0f, limit)` (`:96`), i.e. rightwards only.
- **Why it matters**: In Arabic the message slides to the right, on top of the
  reply arrow that just appeared on the right, so the affordance is hidden under
  the thing it describes, and the gesture runs in the direction a right-to-left
  reader expects to mean "forward", not "reply".
- **Fix**: Read `LocalLayoutDirection` and negate the sign of both the clamp and
  the offset in RTL (or use the `Modifier.offset(x: Dp)` overload, which mirrors
  automatically).

### [BAD] Mention suggestions push the whole conversation up

- **Where**: `ui/chat/Composer.kt:266`, definition at `:376-412`
- **What**: `MentionSuggestions` is rendered as a normal child of the composer
  `Column` (`:266`) — a `Column` with a background, in the layout flow.
- **Why it matters**: Type "@" and the message list jumps up by the height of
  eight suggestion rows; delete the "@" and it jumps back. The web renders its
  autocomplete as a popup anchored over the list
  (`web/src/components/composer/Autocomplete.tsx`), so nothing moves.
- **Fix**: Render it in a `Popup` anchored to the composer, or overlay it with a
  `Box` so the list keeps its position.

### [BAD] Long-press exists on exactly one surface, and nothing hints at it

- **Where**: `ui/chat/MessageRow.kt:94` is the only `combinedClickable` in the
  whole module
- **What**: Messages have a long-press sheet. Channels
  (`ui/main/Sidebar.kt:228`), servers (`Sidebar.kt:101`), DM rows
  (`Sidebar.kt:322`), members (`ui/sheets/ChannelSheets.kt:118`), friends
  (`ui/friends/FriendsScreen.kt:145`), roles
  (`ui/server/ServerSettingsScreen.kt:361`) and sticker packs all use plain
  `clickable`. The web has right-click menus for every one of these —
  `web/src/components/sidebar/serverMenu.ts:52-133`,
  `sidebar/dmMenu.ts:76-153`, `chat/messageMenu.ts:59-106`.
- **Why it matters**: Mark-as-read, mute, leave server, copy ID, create channel,
  edit channel, notification level, close DM — none of them exist on the phone.
  Muting is buried in the channel-settings sheet (`ChannelSheets.kt:313-327`)
  and nothing else is reachable at all.
- **Fix**: Add `combinedClickable` + a shared `ContextSheet` composable to the
  sidebar rows, starting with mark-as-read, mute and leave.

### [BAD] Reactions have no way to add one and no way to see who reacted

- **Where**: `ui/chat/MessageRow.kt:277-318`
- **What**: The reaction row only renders existing reactions. There is no
  trailing "+" button, and a pill's only gesture is toggle (`:289-295`).
- **Why it matters**: To add a reaction you must long-press the message, wait
  for the sheet, and pick from a six-emoji quick row. The web puts a `SmilePlus`
  button directly after the pills — always visible on touch
  (`web/src/components/chat/Reactions.tsx:81-83`,
  `chat/Chat.module.css:88, 94, 104`) — and lazily loads the reactor names into
  a tooltip on hover (`Reactions.tsx:60-69`).
- **Fix**: Append an add-reaction chip to the row that opens the picker anchored
  to the message; long-press a pill to fetch and show the reactor list.

### [BAD] Tapping a reply preview does nothing

- **Where**: `ui/chat/MessageRow.kt:248-274`
- **What**: `ReplyPreview` is a `Row` with an icon, an author name and inline
  markdown. It has no `clickable`.
- **Why it matters**: The reply line is exactly where a reader reaches to find
  the message being answered. The web jumps to it
  (`web/src/components/chat/MessageItem.tsx:45-63`). On the phone it is inert
  decoration.
- **Fix**: Make the row clickable and route it through the same `jumpTo` used by
  search and pins.

### [BAD] No unread divider and no "new messages" bar

- **Where**: `ui/chat/ChatScreen.kt:129-153`
- **What**: The list renders only `DayDivider` (`ui/chat/MessageRow.kt:88, 343`)
  and message rows. There is no unread marker and no banner for messages that
  arrive while you are scrolled up.
- **Why it matters**: Opening a conversation with 40 unread messages drops you
  at the bottom with no way to tell where you stopped reading. The web draws a
  red "New" rule at the read boundary
  (`web/src/components/chat/MessageList.tsx:113-116, 375`;
  `chat/Chat.module.css:45-46`) and a "New messages / Jump to present" pill
  across the top (`MessageList.tsx:358`).
- **Fix**: Capture `readStates[channelId].lastReadMessageId` once on channel
  mount and insert an unread row before that boundary, as web does at
  `MessageList.tsx:89, 102`.

### [BAD] The jump-to-newest button only scrolls; it never fetches

- **Where**: `ui/chat/ChatScreen.kt:156-165`
- **What**: `listState.animateScrollToItem(0)` (`:160`). The button only shows
  when `firstVisibleItemIndex > 4` (`:156`).
- **Why it matters**: Item 0 is the newest message *in memory*. There is no
  load-newer path in `MessageService` at all, so the button cannot get you back
  to the present after jumping into history. The web refetches the newest page
  when `hasNewer` (`web/src/components/chat/MessageList.tsx:279-288`).
- **Fix**: Add `loadNewest(channelId)` and call it when the list is not anchored
  at the live tail before scrolling.

### [BAD] Every `t()`-built constant freezes in the language it was first read in

- **Where**: `ui/pickers/EmojiIndex.kt:24-34` (`GROUPS`); `data/Perms.kt:56`
  (`P.GROUPS`)
- **What**: Both are top-level `val`s inside a Kotlin `object`, initialised by
  calling `t(...)` the first time the object is touched. `MainActivity` keys the
  whole tree on `Strings.epoch` (`MainActivity.kt:99`) so composables rebuild on
  a language change, but a `val` in an object is initialised once per process.
- **Why it matters**: Open the emoji picker in English, switch to Arabic in
  Settings: every category heading ("Smileys & Emotion", "Flags") stays English
  until the app is force-stopped. Same for every role-permission label and
  description in the role editor
  (`ui/server/ServerSettingsScreen.kt:294-311`).
- **Fix**: Make both `get()` properties, or pass `Strings.epoch` as a parameter:
  `fun groups(): List<Pair<Int, String>>` evaluated per call.

### [BAD] A dozen strings bypass the translation catalogue

- **Where**: `ui/chat/ChatScreen.kt:280-281` ("is typing…", "and", "are
  typing…"); `ui/chat/MessageRow.kt:153` ("edited"), `:324-331` (all five system
  messages); `ui/voice/CallScreen.kt:164` ("N in the call · encrypted end to
  end"), `:230` ("frames sealed · opened · dropped");
  `ui/voice/IncomingCallScreen.kt:61` ("is calling");
  `ui/sheets/ProfileSheet.kt:131` ("ROLES");
  `ui/invite/InviteScreen.kt:84, 91` ("a conversation", "member/members",
  "online"); `ui/server/ServerSettingsScreen.kt:127-128, 407` ("members",
  "channels", "uses of"); `ui/chat/Composer.kt:132` ("… is larger than this
  server accepts."); `ui/auth/AuthScreen.kt:168` and
  `ui/settings/SettingsScreen.kt:563` ("6-digit code");
  `ui/markdown/Render.kt:361-375` (`relative()` builds "in 5 minutes" / "3 hours
  ago" with an English `"${unit}s"` plural)
- **What**: Hardcoded English, in an app that ships eleven languages and had a
  whole `Strings` layer built for this.
- **Why it matters**: An Arabic reader sees Arabic chrome with English "is
  typing…", English system joins, English "edited" and English relative
  timestamps in the middle of RTL text. `relative()` also pluralises by
  appending "s", which is wrong in most of the shipped languages even in English
  form.
- **Fix**: Route all of them through `t()` with named placeholders, and use the
  plural form support already in `Strings.t` (`i18n/Strings.kt:151-160`) for
  counts and for `relative()`.

### [BAD] Dates and numbers use two different locales in the same sentence

- **Where**: `ui/markdown/Render.kt:347-357` vs `ui/chat/MessageRow.kt:368-391`;
  `ui/chat/AttachmentViews.kt:270-275`; `ui/chat/Players.kt:152-155`
- **What**: `MessageRow` deliberately formats with `Locale.forLanguageTag(Strings.tag)`
  and documents why (`:361-367`). But `formatTimestamp` uses
  `DateFormat.getTimeInstance(...)` with no locale (`Render.kt:350-356`), i.e.
  the *phone's* locale, and `formatSize`/`clock` use `String.format` with the
  default locale (`AttachmentViews.kt:271-274`, `Players.kt:154`) while
  `Strings.t` formats numbers with the app's locale
  (`i18n/Strings.kt:140`).
- **Why it matters**: Someone reading Nexa in Arabic on an English phone gets
  Arabic digits in "3 مشتركين" and Latin digits in "1.4 MB" and an English-format
  `<t:...>` timestamp, in the same message.
- **Fix**: Give `Render.formatTimestamp` and the two `format` helpers
  `Locale.forLanguageTag(Strings.tag)` explicitly.

### [BAD] Nothing that "looks like a button" is a button to a screen reader

- **Where**: `ui/friends/FriendsScreen.kt:116-130` (Send);
  `ui/settings/SettingsScreen.kt:277-288` (Change avatar / banner), `:462-467`
  (Unblock), `:550`, `:556`, `:591` (copy secret, open authenticator, copy
  codes), `:642-650` (Sign out a device);
  `ui/server/ServerSettingsScreen.kt:259-264` (Kick), `:411-419` (Revoke),
  `:443-451` (Unban); `ui/sheets/ProfileSheet.kt` via `OutlineAction:216-220`
- **What**: Seventeen call sites attach `Modifier.clickable` to a bare `Text` or
  `Box` with no `Modifier.semantics { role = Role.Button }` and no
  `onClickLabel`.
- **Why it matters**: TalkBack announces "Kick" as static text, gives no "double
  tap to activate" hint, and the row is not reachable in the button traversal
  order. A destructive action (Kick, Sign out, Revoke) is the worst case for
  this.
- **Fix**: Add `Modifier.clickable(onClickLabel = …, role = Role.Button)` at all
  of them, or replace them with `TextButton`, which also fixes the touch target
  (next finding).

### [BAD] A dozen controls are well under the 48 dp touch minimum

- **Where**: `ui/chat/Composer.kt:201, 213` (16 dp);
  `ui/server/ServerSettingsScreen.kt:376` (18 dp);
  `ui/main/Sidebar.kt:298` (20 dp), `:375` (22 dp);
  `ui/sheets/ChannelSheets.kt:385` (20 dp);
  `ui/settings/SettingsScreen.kt:91` (24 dp);
  `ui/sheets/Misc.kt:107, 116, 306` (24-26 dp);
  `ui/server/ServerSettingsScreen.kt:88, 347` (24, 28 dp);
  `ui/chat/MessageActions.kt:97` (26 dp); `ui/voice/CallScreen.kt:151` (28 dp)
- **What**: `Modifier.size(N.dp).clickable { … }` where N is the *icon* size, so
  the touch target equals the glyph.
- **Why it matters**: The 16 dp X that cancels a reply or an edit
  (`Composer.kt:201, 213`) is a third of the minimum and sits right beside the
  text you are reading; missing it does nothing, so people jab at it. The 18 dp
  delete-role icon is a destructive action at 18 dp. Every settings and server
  back arrow is 24 dp, so back presses miss.
- **Fix**: Wrap each in `IconButton` (which enforces 48 dp via
  `minimumInteractiveComponentSize`) or add
  `Modifier.size(48.dp).clickable { }` with the icon centred inside.

### [BAD] Light theme: the system navigation bar icons stay light

- **Where**: `ui/theme/Theme.kt:222-226`
- **What**: The `SideEffect` sets `isAppearanceLightStatusBars = !dark` and
  nothing else. `isAppearanceLightNavigationBars` is never set, and
  `enableEdgeToEdge()` is called with no arguments before the theme is known
  (`MainActivity.kt:68`).
- **Why it matters**: On a three-button-navigation phone in the Light theme the
  back/home/recents glyphs are white on a near-white transparent bar — you
  cannot see the navigation buttons.
- **Fix**: Set `isAppearanceLightNavigationBars = !dark` in the same
  `SideEffect`.

### [BAD] Cold start flashes dark for light-theme users

- **Where**: `android/app/src/main/res/values/themes.xml`,
  `res/values/colors.xml`
- **What**: `Theme.Nexa` sets `android:windowBackground="@color/window_background"`,
  which is `#2C2D32` — the dark palette's `bgBase`. There is no
  `values-night/` variant and no `values/themes.xml` light alternative.
- **Why it matters**: Every launch, and every configuration change that recreates
  the window, a light-theme user sees a full-screen dark slab before Compose
  paints.
- **Fix**: Add `res/values-night/colors.xml` with the dark value and make
  `res/values/colors.xml` `#F3F3F4`, so the window background follows the system
  before the app's own theme is known.

### [BAD] Light theme: floating surfaces are invisible against the background

- **Where**: `ui/theme/Theme.kt:122, 125` (bgBase `F3F3F4`, bgFloating
  `FFFFFF`); consumers at `MainActivity.kt:226` (toasts),
  `ui/chat/ChatScreen.kt:159` (jump-to-newest button),
  `ui/chat/Composer.kt:394` (mention suggestions)
- **What**: Three "floating" elements are drawn as a plain
  `background(colors.bgFloating)` with no border, no elevation and no shadow. In
  the Light theme that is white on `F3F3F4`.
- **Why it matters**: A toast is an unreadable white rectangle; the
  jump-to-newest circle disappears entirely over light message content; the
  mention list merges with the background.
- **Fix**: Give each a `Modifier.shadow(6.dp, shape)` or a
  `border(1.dp, colors.borderSubtle, shape)`.

### [BAD] Light theme: the composer pill barely separates from the page

- **Where**: `ui/theme/Theme.kt:122, 126` (bgBase `F3F3F4`, bgComposer
  `EBECED`); used at `ui/chat/Composer.kt:279`
- **What**: In Dark the composer is `393A41` on `2C2D32` — a clear step. In
  Light it is `EBECED` on `F3F3F4`, an 8-unit difference.
- **Why it matters**: The input you are meant to tap has almost no edge.
- **Fix**: Either lighten `bgComposer` to `FFFFFF` in `LightColors` or add a
  1 dp `borderSubtle` outline to the pill.

### [BAD] The GIF picker fires a network request per keystroke and reports every failure as "not set up"

- **Where**: `ui/pickers/Pickers.kt:212-219`
- **What**: `LaunchedEffect(query) { … ExpressionsApi.gifSearch(query) … }` with
  no debounce; `onFailure` sets a single fixed string,
  `t("pickers.pickers.gifSearchIsNotSetUp")` (`:217`).
- **Why it matters**: Typing "cat" makes three searches and shows three
  loading spinners. If the phone is offline, or the request times out, or the
  server 500s, the user is told GIF search is not set up on this instance — a
  message that sends them to the wrong place entirely. The web debounces 300 ms
  and distinguishes disabled from failed
  (`web/src/components/pickers/GifPicker.tsx:57-104, 189`).
- **Fix**: `delay(300)` at the top of the effect, and branch the error on the
  API status (404/501 → "not set up", anything else → "Couldn't load GIFs. Try
  again.") with a retry button.

### [BAD] The user search in "New message" also fires per keystroke

- **Where**: `ui/sheets/Misc.kt:149-155`
- **What**: `LaunchedEffect(query) { if (query.length >= 2) UsersApi.search(query) }`
  with no debounce, and the result of a slower earlier request can land after a
  faster later one because nothing tracks ordering beyond effect cancellation on
  recomposition.
- **Why it matters**: A request per character against the user directory, and
  the list flickers between stale and fresh results while typing.
- **Fix**: `delay(250)` before the call.

### [BAD] The sticker picker shows packs you have not installed

- **Where**: `ui/pickers/Pickers.kt:270`, compare `:87`
- **What**: `val installed = packs.filter { it.kind == "sticker" }` — the
  variable is named `installed` but the `it.installed` predicate is missing. The
  emoji path four lines of logic away gets it right:
  `packs.filter { it.kind == "emoji" && it.installed }` (`:87`).
- **Why it matters**: Every sticker pack the client has ever seen — including
  packs from servers you browsed and never added — appears in your picker, so
  the "no sticker packs yet" empty state (`:277`) almost never shows and the
  Add/Remove buttons in the pack screen appear to do nothing.
- **Fix**: `packs.filter { it.kind == "sticker" && it.installed }`.

### [BAD] Spoiler images put the reveal pill in the wrong place

- **Where**: `ui/chat/AttachmentViews.kt:83-108`
- **What**: The container's height comes from
  `aspectRatio(ratio)` where ratio is derived from the image (`:78-84`), but the
  unrevealed overlay is a fixed `Box(Modifier.fillMaxWidth().height(200.dp))`
  (`:97`) and is not aligned to the parent.
- **Why it matters**: On a tall image the "Spoiler" pill sits near the top
  instead of the centre; on a short one the 200 dp overlay is taller than the
  image and the pill lands below it, over the next message.
- **Fix**: `Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center)`.

### [BAD] The image viewer lets you fling the picture off-screen

- **Where**: `ui/sheets/Misc.kt:88-99`
- **What**: `detectTransformGestures` accumulates `offsetX += pan.x` /
  `offsetY += pan.y` with no bounds check against the scaled image size
  (`:92-93`); offsets only reset when `scale` returns to 1 (`:95-96`).
- **Why it matters**: Zoom in, pan hard, and the photo leaves the viewport
  entirely — you are looking at a black screen with no indication anything is
  wrong, and the only recovery is pinching back out blind.
- **Fix**: Clamp `offsetX`/`offsetY` to `±(size * (scale - 1) / 2)` after each
  gesture, and add a double-tap to reset.

### [BAD] Video attachments download with a spinner and no progress

- **Where**: `ui/chat/AttachmentViews.kt:140-152`; the progress callback exists
  at `media/AttachmentStore.kt` and is used for files at `:181`
- **What**: `runCatching { AttachmentStore.file(meta) }` (`:143`) is called
  without the `onProgress` lambda that `FileAttachment` passes (`:181`), so the
  play button shows an indeterminate spinner for the whole download.
- **Why it matters**: A 200 MB video is a spinner that looks frozen for a
  minute, with no size, no percentage and no cancel.
- **Fix**: Pass the progress callback and draw a determinate
  `CircularProgressIndicator(progress = …)`, as the staged-upload strip already
  does (`ui/chat/Composer.kt:245-250`).

### [BAD] Settings and server settings ignore the system back button

- **Where**: `ui/main/MainScreen.kt:66`; `ui/settings/SettingsScreen.kt:81,
  91-93`; `ui/server/ServerSettingsScreen.kt:73, 88-91`
- **What**: Both screens keep their sub-page in local state (`page`) and give
  their own arrow a two-step behaviour: sub-page → root, root → leave
  (`SettingsScreen.kt:92`). `MainScreen`'s `BackHandler` knows nothing about it
  and does `route !is Route.Chat -> Nav.go(Route.Chat(null, null))`
  (`MainScreen.kt:66`).
- **Why it matters**: On the Security page, the on-screen arrow goes back to the
  settings list and the hardware/gesture back throws you out to the chat. The
  same control does two different things depending on where your thumb is.
- **Fix**: Add a `BackHandler(enabled = page != "root") { page = "root" }` inside
  each screen — it takes precedence over the outer one — or move the sub-page
  into `Route.Settings(page)` where it already has a slot (`ui/Nav.kt:9`).

### [BAD] Friends: the last rows sit under the gesture bar

- **Where**: `ui/friends/FriendsScreen.kt:70, 139`
- **What**: The root `Column` has no `navigationBarsPadding()` and the
  `LazyColumn` (`:139`) has no `contentPadding` for the bottom inset, while
  every sheet and both settings screens do apply one.
- **Why it matters**: The last friend in the list is half under the navigation
  bar and its accept/decline buttons are not reliably tappable.
- **Fix**: `contentPadding = WindowInsets.navigationBars.asPaddingValues()` on
  the `LazyColumn`.

### [BAD] The drawer's self panel sits under the gesture bar too

- **Where**: `ui/main/Sidebar.kt:355-378` (`SelfPanel`), `:79` (`ServerRail`)
- **What**: `ServerRail` applies `statusBarsPadding()` (`:79`) but the column it
  lives in has no bottom inset, and `SelfPanel` — the strip with your avatar and
  the settings gear — has only `padding(horizontal = 10.dp, vertical = 8.dp)`
  (`:360`).
- **Why it matters**: The settings gear (`:372-376`, itself a 22 dp target) is
  partly behind the system gesture bar, so opening Settings frequently triggers
  the system gesture instead.
- **Fix**: `Modifier.navigationBarsPadding()` on `SelfPanel`, and on the
  `ServerRail` column.

### [BAD] Avatar status halos are the wrong colour everywhere but the chat list

- **Where**: `ui/common/Common.kt:93`
- **What**: The ring behind the presence dot is hardcoded to
  `background(colors.bgBase)`. `Avatar` is drawn on `bgRaised` in the sidebar
  (`ui/main/Sidebar.kt:59, 330`) and the chat header
  (`ui/chat/ChatScreen.kt:202, 212`), and on `bgFloating` inside every sheet.
- **Why it matters**: A visible grey donut around every avatar in the drawer and
  in the member list — most obvious in the Light theme, where `bgBase` (`F3F3F4`)
  sits on `bgRaised` (`FFFFFF`).
- **Fix**: Add a `ringBackground: Color = chatColors.bgBase` parameter and pass
  the actual surface colour from each call site.

### [BAD] Every read of `firstVisibleItemIndex` happens in composition

- **Where**: `ui/chat/ChatScreen.kt:96` and `:156`
- **What**: `LaunchedEffect(channelId, messages.lastOrNull()?.id, listState.firstVisibleItemIndex)`
  (`:96`) uses a scroll position as an effect key, and `if (listState.firstVisibleItemIndex > 4)`
  (`:156`) reads it in the composable body.
- **Why it matters**: Both make `ChatScreen` — and therefore the entire message
  `LazyColumn`, the header and the composer — recompose on every item boundary
  crossed while scrolling, and cancel/restart the ack coroutine along with it.
  It is the most likely cause of scroll jank in a long conversation.
- **Fix**: `val showJump by remember { derivedStateOf { listState.firstVisibleItemIndex > 4 } }`
  and key the ack effect on a `derivedStateOf { listState.firstVisibleItemIndex <= 2 }`
  boolean instead of the raw index.

### [BAD] The emoji grid re-filters the whole set on every keystroke

- **Where**: `ui/pickers/Pickers.kt:83-150`, in particular `:138-139`
- **What**: Inside the `ModalBottomSheet` content lambda — which recomposes on
  every character typed into the search field — the code rebuilds `custom`
  (`:83-86`), `packEmoji` (`:87`), then for each of nine groups calls
  `EmojiIndex.group(id)` (`:139`), which is
  `entries.filter { it.group == id }` over the whole ~1,900-entry list
  (`ui/pickers/EmojiIndex.kt:73`). None of it is inside `remember`.
- **Why it matters**: Nine full-list scans plus two list builds per keystroke, on
  the main thread, while a 1,900-item lazy grid is also being rebuilt. The web
  virtualises its grid and throttles scroll to one rAF
  (`web/src/components/pickers/EmojiPicker.tsx:53-59, 312-322`).
- **Fix**: `remember(EmojiIndex.loaded) { EmojiIndex.GROUPS.map { it to EmojiIndex.group(it.first) } }`,
  and `remember(query, emojis, packs) { … }` for the filtered lists.

---

### [POLISH] No skin-tone selector, though the setting is read

- **Where**: `ui/pickers/Pickers.kt:130-131, 143-144`;
  `data/SettingsStore.kt:148`
- **What**: `EmojiIndex.withTone(entry, SettingsStore.skinTone)` is applied in
  four places, and nothing in the Android app ever writes `skinTone`.
- **Why it matters**: Android users are stuck on whatever tone the web client
  set. The web has a full `ToneSelector` beside the search box with six hands,
  arrow-key navigation and `role="menuitemradio"`
  (`web/src/components/pickers/EmojiPicker.tsx:147-211, 366`).
- **Fix**: Add a tone button to `SearchField`'s row writing
  `SettingsStore.put("skinTone", n)`.

### [POLISH] The emoji picker has no category navigation

- **Where**: `ui/pickers/Pickers.kt:89-150`
- **What**: One long `LazyVerticalGrid` with nine `header(…)` rows and no jump
  affordance, no sticky header and no sidebar.
- **Why it matters**: Reaching Flags means scrolling through roughly 1,800
  emoji. The web has a 48 dp vertical category rail with nine icons plus one per
  emoji pack and one per server
  (`web/src/components/pickers/Picker.module.css:22`,
  `EmojiPicker.tsx:369-386`) and a sticky section header
  (`EmojiPicker.tsx:350-358`).
- **Fix**: Add a `LazyRow` or side rail of category buttons that
  `animateScrollToItem` to each header's index, and make the current section's
  header sticky with `stickyHeader`.

### [POLISH] Picking an emoji closes the picker

- **Where**: `ui/chat/Composer.kt:336`
- **What**: `onPick` sets `picker = null` after inserting the token.
- **Why it matters**: Sending "🎉🎉🎉" takes three full open/scroll/tap cycles.
  The web deliberately keeps the picker open for emoji (its `onEmoji` only
  inserts text — `web/src/components/composer/Composer.tsx:440-443`) and closes
  only for stickers and GIFs (`Composer.tsx:445-446`), which send immediately.
- **Fix**: Drop the `picker = null` from the emoji branch; keep it for GIF and
  sticker.

### [POLISH] The reaction picker stacks a second sheet on top of the first

- **Where**: `ui/chat/MessageActions.kt:151-162`
- **What**: `EmojiPickerSheet` is composed while the `MessageActions`
  `ModalBottomSheet` is still in the tree (`:82`), so two modal sheets with two
  scrims are live at once.
- **Why it matters**: The scrim doubles, the background goes almost black, and
  the action sheet is still visible behind the emoji grid. Back dismisses only
  the top one.
- **Fix**: Hide the action sheet first (`sheetState.hide()`), then show the
  picker; the web anchors its picker to the button and never stacks
  (`web/src/components/chat/Reactions.tsx:84`).

### [POLISH] `:shortcode:` expansion is written and never wired up

- **Where**: `ui/pickers/EmojiIndex.kt:92-98`
- **What**: `expandShortcodes` has a doc comment saying "as the web client
  does", and no caller anywhere in the module.
- **Why it matters**: Typing `:shrug:` on the phone sends the literal text,
  while the same account on the web turns it into the emoji. The web also has a
  live `:emoji:` autocomplete (`web/src/components/composer/Autocomplete.tsx`,
  tokens at `Composer.tsx:49-59`).
- **Fix**: Call it in `Composer.doSend` before sending, and add a `:` branch to
  `MentionSuggestions`.

### [POLISH] No slash commands

- **Where**: `ui/chat/Composer.kt:295-310`
- **What**: The text field has no command handling.
- **Why it matters**: `/shrug /tableflip /unflip /lenny /me /spoiler` all work
  on the web (`web/src/components/composer/commands.ts:10-32`), so the same
  account behaves differently depending on the device.
- **Fix**: Port `commands.ts` and expand in `doSend`, plus a `/` branch in the
  suggestion list.

### [POLISH] No character counter and no length limit

- **Where**: `ui/chat/Composer.kt:295-310`
- **What**: `BasicTextField` with no `maxLength` check and no counter.
- **Why it matters**: The web caps at 4,000 and shows a counter in the last 200
  characters, red past the limit (`web/src/components/composer/Composer.tsx:35,
  422, 507`). On the phone a long message is composed happily and then rejected
  by the server as an opaque toast (`Composer.kt:182`).
- **Fix**: Enforce the same 4,000 cap in `onValueChange` and show a counter once
  within 200 of it.

### [POLISH] The staged-attachment error field is never shown

- **Where**: `ui/chat/Composer.kt:75`, `:221-263`
- **What**: `private data class Staged(val file: PickedFile, var progress: Float = 0f, var error: String? = null)`
  — `error` is never written and never read.
- **Why it matters**: When one file in a batch fails to upload, the whole send
  throws and the toast names only the exception; the thumbnail gives no clue
  which file failed. The web shows a per-file error in the tray
  (`web/src/components/composer/Composer.tsx:460-478`).
- **Fix**: Catch per-file in the upload loop (`Composer.kt:155-165`), set
  `error`, and draw it on the thumbnail.

### [POLISH] The attach button vanishes instead of leaving a gap

- **Where**: `ui/chat/Composer.kt:272-276`
- **What**: `if (canAttach) { IconButton(…) }` with no `else`.
- **Why it matters**: In a channel where you cannot attach files, the whole
  composer shifts 48 dp toward the leading edge, so the input pill is a
  different size and position than in every other channel. The web keeps a
  spacer (`web/src/components/composer/Composer.tsx:481`).
- **Fix**: `else Spacer(Modifier.width(48.dp))`.

### [POLISH] Tapping a message body gives a ripple and does nothing

- **Where**: `ui/chat/MessageRow.kt:94`
- **What**: `.combinedClickable(onClick = {}, onLongClick = onLongPress)`.
- **Why it matters**: Every message reads as a button to TalkBack and shows a
  press ripple, but a tap has no effect. There is also no visual hint that
  long-press is the way to react, reply or copy — the only affordance for the
  entire action set is invisible.
- **Fix**: Use `Modifier.pointerInput { detectTapGestures(onLongPress = …) }` so
  there is no click semantics, or make the tap do something (reveal the gutter
  timestamp, as the web does on hover — `web/src/components/chat/MessageItem.tsx:195`).

### [POLISH] Avatar and server-icon initials overflow at large font scales

- **Where**: `ui/common/Common.kt:85` and `:139`
- **What**: `fontSize = (size.value * 0.42f).sp` inside a fixed
  `Modifier.size(size)` circle (and `* 0.34f` for `ServerIcon`). `sp` scales with
  the user's font-size setting; `dp` does not.
- **Why it matters**: At 130 % system font the initial no longer fits its circle;
  at 200 % it is clipped to a stub.
- **Fix**: Convert with `with(LocalDensity.current) { (size * 0.42f).toSp() }`,
  which gives a density-scaled but font-scale-independent size.

### [POLISH] The server-rail unread dot is clipped by the rail

- **Where**: `ui/main/Sidebar.kt:109-114`
- **What**: The dot is `align(Alignment.CenterStart).offset(x = (-14).dp).size(8.dp)`
  on a `Box` that wraps the 48 dp rail button, inside a 72 dp column
  (`:79`) with `CenterHorizontally` alignment — i.e. only 12 dp of slack on each
  side. The dot needs 14.
- **Why it matters**: The unread pill is sliced off at the leading edge of the
  rail on every unread server.
- **Fix**: `offset(x = (-10).dp)` or widen the rail to 76 dp.

### [POLISH] The sticker-pack screen throws away where you were

- **Where**: `ui/sheets/Misc.kt:302-310`
- **What**: The back affordance is `Lucide.X` and it calls
  `Nav.go(Route.Chat(null, null))` (`:306`).
- **Why it matters**: Opening a sticker-pack link from a message drops you at
  the empty "No conversation open" screen when you close it — which, per the
  BROKEN finding above, then has no way back to the list.
- **Fix**: Use `Lucide.ArrowLeft` and restore the previous route (keep a
  one-deep back stack in `Nav`, or push the pack as a `Layer` instead of a
  `Route`).

### [POLISH] The `AttachmentList` channel parameter is dead

- **Where**: `ui/chat/AttachmentViews.kt:61`
- **What**: `fun AttachmentList(attachments: List<AttachmentMeta>, channelId: String)`
  — `channelId` is never referenced in the body.
- **Why it matters**: Minor, but it is a false signal that attachments are
  channel-aware (they are not — the image viewer looks up its metadata by
  scanning every channel, `ui/sheets/Misc.kt:127-135`).
- **Fix**: Remove the parameter, or use it so `ImageViewerLayer` can be given the
  channel instead of scanning.

### [POLISH] The image viewer scans every message in every channel

- **Where**: `ui/sheets/Misc.kt:127-135`
- **What**: `findAttachment` loops over `AppState.channels.value.keys`, then over
  every decrypted message in each, looking for a blob id.
- **Why it matters**: Opening a picture after a long session is a linear scan of
  the whole in-memory history on the composition thread.
- **Fix**: Carry the `AttachmentMeta` in `Layer.ImageViewer` instead of the blob
  id.

### [POLISH] No placeholder while any image loads

- **Where**: `media/CoilSetup.kt:39-61`; every `AsyncImage` call site
- **What**: The shared `ImageLoader` sets `crossfade(true)` (`:60`) but no
  `placeholder` or `error`, and no call site passes one.
- **Why it matters**: Avatars, server icons, emoji, stickers and GIF thumbnails
  all pop in from empty space, so a scroll through history is a field of holes
  filling in. An emoji that fails to load leaves a gap in the middle of a
  sentence with no fallback.
- **Fix**: Give `AsyncImage` a `placeholder` (the avatar's initials box already
  exists at `ui/common/Common.kt:76-89`) and an `error` fallback, and for
  Twemoji fall back to the glyph, which `TwemojiImage` already does only when
  the URL is null (`ui/common/TwemojiImage.kt:23-26`).

### [POLISH] Toasts drop while one is showing, and hide behind the keyboard

- **Where**: `MainActivity.kt:214-231`
- **What**: The collector holds the coroutine for four seconds inside `collect`
  (`:219-221`), and `toasts` is a `MutableSharedFlow(extraBufferCapacity = 8)`
  (`data/Session.kt:70`) — so a ninth message during that window is dropped. The
  toast box has `navigationBarsPadding()` (`:225`) but no `imePadding()`.
- **Why it matters**: Three upload rejections in a row show one message. A toast
  raised while typing (the most common case — send failures) appears behind the
  keyboard where nobody sees it.
- **Fix**: Keep a queue in state and pop from it on a timer, and add
  `.imePadding()` beside the nav-bar padding.

### [POLISH] The offline screen has no retry and no motion

- **Where**: `MainActivity.kt:198-210`
- **What**: A single centred line of muted text and a silent 5-second
  `Session.bootstrap()` loop (`:204-209`).
- **Why it matters**: There is nothing to indicate the app is still trying, and
  no way to force a retry after switching Wi-Fi. The web has a full offline page
  with a visible retry button, exponential backoff and a retry-on-`online`
  listener (`web/src/pages/OfflinePage.tsx:18-62`).
- **Fix**: Add a spinner, a "Try again" button, and back off 2 s → 30 s instead
  of a flat 5 s.

---

### [IDEA] There is no quick switcher

- **Where**: nothing in `ui/` implements one; the DM list header has only a "+"
  (`ui/main/Sidebar.kt:295-299`)
- **What**: The web has a Ctrl/Cmd+K modal with two modes — "Jump to" (fuzzy
  over DMs, groups, servers, channels and friends) and "Messages" (search over
  everything decrypted, with `from:` operators) —
  `web/src/components/modals/QuickSwitcher.tsx:41-205`. Its DM sidebar even has
  a search-shaped button that opens it (`sidebar/DMSidebar.tsx:53-55`).
- **Why it matters**: On a phone with 30 servers, finding a channel means
  opening the drawer, tapping the right server icon and scrolling. There is no
  search over the sidebar at all.
- **Fix**: Port `QuickSwitcher` as a full-screen search sheet reachable from a
  search field at the top of the drawer.

### [IDEA] No drag-reorder for servers, though the setting is already synced

- **Where**: `ui/main/Sidebar.kt:75` reads `SettingsStore.serverOrder`;
  `data/SettingsStore.kt:178` `setServerOrder` is never called
- **What**: The rail honours the order the web client saved but offers no way to
  change it. The web supports drag-reorder for the rail
  (`web/src/components/rail/Rail.tsx:98-119`) and for channels and categories
  (`sidebar/ServerSidebar.tsx:84-155`).
- **Fix**: Long-press-and-drag on the rail writing back through
  `setServerOrder`.

### [IDEA] Channels and categories cannot be created or edited from the phone

- **Where**: `net/Endpoints.kt:197` (`createChannel`) has no caller in `ui/`
- **What**: Server settings covers overview, members, roles, invites, bans and
  audit log (`ui/server/ServerSettingsScreen.kt:98-105`) — no channel
  management. Editing a single channel's name and topic is possible only from
  the chat header's settings sheet (`ui/sheets/ChannelSheets.kt:258`).
- **Fix**: Add a Channels page to `ServerSettingsScreen` with create, rename,
  reorder and delete.

### [IDEA] No GIF favourites

- **Where**: `ui/pickers/Pickers.kt:204-260`
- **What**: The GIF sheet has trending and search only. The web has Favorites as
  the *default* sub-tab, a star overlay on results, an X on favourites, a
  broken-favourite cleanup, and a favourite button on GIF embeds in chat
  (`web/src/components/pickers/GifPicker.tsx:30, 142, 166-173`;
  `chat/Embeds.tsx:33-49`). The field is already in the synced settings
  (`web/src/stores/settings.ts:72`).
- **Fix**: Add a Favourites tab reading and writing `favoriteGifs`.

### [IDEA] No hover/press preview for emoji or stickers

- **Where**: `ui/pickers/Pickers.kt:172-199, 290-297`
- **What**: Cells are 46 dp (emoji) and 84 dp (stickers) with no name shown. The
  web has a 40 px inspector strip at the bottom of the emoji tab showing the
  hovered emoji large plus its `:shortcode:`
  (`web/src/components/pickers/EmojiPicker.tsx:117-138, 408`).
- **Fix**: Show the name in a footer strip on press-and-hold, which also gives
  the shortcode a discoverable home.

### [IDEA] No call banner when the call screen is closed

- **Where**: `ui/voice/CallScreen.kt:150-151` closes the layer;
  `ui/sheets/Layers.kt:20`
- **What**: The chevron calls `onClose` → `Nav.popTo(layer)`, which removes the
  call UI while `VoiceSession` stays joined (only the hang-up button at `:281`
  leaves).
- **Why it matters**: You are still in a call with a live microphone and the app
  shows nothing — no banner, no rail indicator, nothing in the header. The only
  way back is to find and tap the voice channel again. There is a foreground
  notification, but nothing in-app.
- **Fix**: A persistent call bar above the composer / below the header showing
  the channel, a mute toggle and a hang-up, tapping which reopens the call
  screen.

### [IDEA] No front/back camera switch, despite the engine and the icon existing

- **Where**: `voice/VoiceSession.kt:287` (`switchCamera`) has no caller;
  `ui/icons/Lucide.kt:118` (`SwitchCamera`) is unused
- **What**: The call screen offers mic, deafen, camera on/off, screen share,
  speaker and hang-up (`ui/voice/CallScreen.kt:242-285`) — no camera flip. Also
  unused: `VoiceSession.setVolume` (`:254`, no per-participant volume UI) and
  `setWatching(…, false)` — the tile tap only ever subscribes
  (`CallScreen.kt:192`), never unsubscribes.
- **Fix**: Add a `SwitchCamera` control, visible only while `call.video` is on.

### [IDEA] The drawer takes 86 % of the screen even on a tablet

- **Where**: `ui/main/MainScreen.kt:77`
- **What**: `ModalDrawerSheet(modifier = Modifier.fillMaxWidth(0.86f))` with no
  cap, and the drawer is modal at every width — there is no two-pane layout.
- **Why it matters**: On a 10" tablet or an unfolded foldable the drawer is a
  900 dp-wide panel of channel names, and the conversation is hidden behind a
  scrim, when there is easily room for both side by side (which is what the web
  does at every width above the mobile breakpoint —
  `web/src/components/shell/AppShell.tsx:66-142`).
- **Fix**: `widthIn(max = 360.dp)`, and above ~720 dp render the sidebar
  permanently beside the chat instead of in a `ModalNavigationDrawer`.
