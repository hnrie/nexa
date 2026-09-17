# The Android expression picker

> *"stickers were in a non intuitive place. not just one central picker for
> emojis, stickers, and gifs like how discord does it. it was very scuffed and
> weird."* — the owner, about the Android app.

He is right, and the web client in this same repository already does it
properly. This is a design for making the phone match it.

---

## What exists today

### Three separate sheets, two buttons, and a text link

There is no single picker. There are three unrelated `ModalBottomSheet`
composables in one file, and the only way to reach one of them is through
another.

| Sheet | Defined at |
| --- | --- |
| `EmojiPickerSheet` | `android/app/src/main/java/xyz/evilion/chat/ui/pickers/Pickers.kt:62` |
| `GifPickerSheet` | `android/app/src/main/java/xyz/evilion/chat/ui/pickers/Pickers.kt:204` |
| `StickerPickerSheet` | `android/app/src/main/java/xyz/evilion/chat/ui/pickers/Pickers.kt:265` |

They are switched by a `String?` in the composer:
`android/app/src/main/java/xyz/evilion/chat/ui/chat/Composer.kt:101`
(`var picker by remember { mutableStateOf<String?>(null) }`), dispatched in a
`when` at `Composer.kt:328-371`.

### Every entry point, exactly

**From the message box — emoji.**
`Composer.kt:312-314`. A `Lucide.Smile` `IconButton` to the right of the text
field sets `picker = "emoji"`. Always present.

**From the message box — GIFs.**
`Composer.kt:315-318`. A `Lucide.Sticker` `IconButton` sets `picker = "gif"`.
It is wrapped in `if (value.text.isBlank() && staged.isEmpty())` — the *same
slot* as the send button. **The moment you type one character, or stage one
attachment, the GIF/sticker button is replaced by Send and there is no way to
reach GIFs or stickers at all.** Its content description is
`t("composer.gifsAndStickers")` even though it only opens GIFs.

**From the message box — stickers.**
There is no sticker button. Stickers are reachable only from inside the GIF
sheet: `Pickers.kt:226-231` draws the word "Stickers" as brand-coloured `Text`
with a `clickable` modifier in the GIF sheet's search row, which calls
`onOpenStickers` → `Composer.kt:352` → `picker = "sticker"`. This swaps one
`ModalBottomSheet` for another, losing the GIF search you had typed. There is
no way back to GIFs from the sticker sheet.

**From a reaction.**
`ui/chat/ChatScreen.kt:182` opens `MessageActions` on a long press.
`MessageActions.kt:82` is itself a `ModalBottomSheet`. Inside it,
`MessageActions.kt:84-100` draws a row of six quick reactions (four recents,
then `QUICK` at `MessageActions.kt:50`), ending in a `Lucide.Smile` icon at
`MessageActions.kt:96-98` which sets `pickingEmoji = true`. That renders
`EmojiPickerSheet` at `MessageActions.kt:151-162` — **a second
`ModalBottomSheet` stacked on top of the first**, with the action sheet still
mounted and scrimmed behind it. Picking converts the composer token
`<a?:name:blob>` into the reaction key `a?:name:blob` at
`MessageActions.kt:157-159`.

`MessageRow.kt:277-317` draws existing reactions as tappable chips, but there
is **no `+` affordance** beside them: a long press on the message is the only
route to adding a new reaction.

### What is awkward about it

1. **No single picker.** Three sheets, three search boxes, three scroll
   positions, no tabs, no way to move between them except a one-way text link.
2. **Stickers are hidden behind GIFs.** Exactly the complaint. A person looking
   for a sticker has to guess that the GIF button opens something with a word
   "Stickers" in its header.
3. **GIFs and stickers vanish when you type.** `Composer.kt:315`. This is
   probably the single worst part: the feature disappears based on unrelated
   state.
4. **Two icons that mean the same category.** `Lucide.Smile` and
   `Lucide.Sticker` sit side by side; Discord has one.
5. **One pick per open.** `Composer.kt:336` sets `picker = null` after every
   emoji. Discord keeps the emoji sheet open so you can insert several.
6. **A sheet on a sheet for reactions.** `MessageActions.kt:151`.
7. **No category rail.** `Pickers.kt:89-151` puts everything in one long
   `LazyVerticalGrid` with 9+ headers and no way to jump. Scrolling from
   Smileys to Flags means dragging past ~1900 cells.
8. **Headers are not sticky.** `Pickers.kt:156-166` emits a plain full-span
   item; it scrolls away, so halfway down the grid you cannot tell what you are
   looking at.
9. **No skin tone control anywhere in the app.** `SettingsStore.skinTone`
   (`data/SettingsStore.kt:148`) is read at `Pickers.kt:130`, `131`, `143`,
   `144` — and never written. The only way an Android user changes tone is to
   open the web client.
10. **Recents do not update.** `Pickers.kt:88` reads
    `SettingsStore.recentEmoji`, a plain getter over a `JsonObject`
    (`SettingsStore.kt:150`), not a `StateFlow`. Compose never learns it
    changed, so the Recent row is frozen for the life of the sheet.
11. **Recents are written in a format the web then discards.**
    `Pickers.kt:99/110/121/132/146` all call `SettingsStore.rememberEmoji` with
    the *toned* unicode or a full `<:name:blob>` token. The web writes only the
    **base** unicode (`web/src/components/pickers/EmojiPicker.tsx:335`) and
    resolves recents back through `byUnicode` at `EmojiPicker.tsx:279-280`,
    dropping anything it cannot match. So every custom emoji and every toned
    emoji this phone remembers is silently thrown away by the browser, and the
    two clients fight over one shared settings field.
12. **Fixed 460 dp sheet with no insets.** `Pickers.kt:77`, `222`, `273`. No
    `navigationBarsPadding()` (which `sheets/Misc.kt:161` and
    `MessageActions.kt:83` both do use), so the bottom row of cells sits under
    the gesture bar. `skipPartiallyExpanded = true` at `Pickers.kt:65`, `206`,
    `266` means there is no half-height state. On a short phone in landscape
    460 dp does not fit.
13. **Search runs on the main thread, in composition.** `Pickers.kt:126` calls
    `EmojiIndex.search(query)` inside the `LazyVerticalGrid` content lambda,
    and `Pickers.kt:139` calls `EmojiIndex.group(id)` — which is
    `entries.filter { ... }` over 1 906 entries (`ui/pickers/EmojiIndex.kt:73`)
    — nine times, allocating nine lists, on every recomposition.
14. **One network SVG per cell.** `EmojiCell` (`Pickers.kt:182`) →
    `TwemojiImage` (`ui/common/TwemojiImage.kt:20-28`) → `Twemoji.url`
    (`media/Twemoji.kt:58`) → `GET /twemoji/<code>.svg`. Scrolling the whole
    grid issues up to ~1 900 HTTP requests and ~1 900 SVG rasterisations. The
    web client hit exactly this wall and fixed it with sprite sheets —
    `tools/twemoji_sprites.py:4-11` says so in as many words. Android never got
    the fix.
15. **GIF search fires a request per keystroke.** `Pickers.kt:212-219`,
    `LaunchedEffect(query)` with no debounce.
16. **GIF paging is dropped on the floor.** `net/Models.kt:285` has
    `GifPage.next`; `Pickers.kt:216` reads only `.results`. You get one page,
    ever.
17. **One error message for two different failures.** `Pickers.kt:217` shows
    `t("pickers.pickers.gifSearchIsNotSetUp")` for *any* thrown exception —
    an offline phone is told the server has no GIF provider.
    `InstanceInfo.gifSearch` (`net/Models.kt:566`) already tells the app the
    truth and is never consulted.
18. **No GIF favourites.** The web keeps `favoriteGifs` in the shared settings
    document (`web/src/lib/gifFavorites.ts`,
    `web/src/stores/settings.ts:72/103`). Android has no reader or writer for
    it, so a favourite starred on the desktop is invisible on the phone.
19. **Emoji packs and sticker packs are filtered inconsistently.**
    `Pickers.kt:87` takes `kind == "emoji" && it.installed`; `Pickers.kt:270`
    takes `kind == "sticker"` with no `installed` check. The web filters
    neither (`web/src/stores/expressions.ts` `packEmoji`, `groupPacks`), so the
    phone hides emoji packs that the browser shows.
20. **Custom emoji are one undifferentiated blob.** `Pickers.kt:83-86` flattens
    every server's emoji into a single `CUSTOM` section. The web keeps one
    section per server, named, with the server's icon in the rail
    (`EmojiPicker.tsx:259-263`, `376-380`).
21. **No preview/inspector footer.** The web names what is under the pointer
    (`EmojiPicker.tsx:117-138`). On a phone the equivalent — showing the
    shortcode of what you are about to send — does not exist.
22. **No sticker grouping.** `Pickers.kt:286-299` lists packs in arbitrary map
    order. The web groups them "This server / My packs / Installed / Other
    servers" (`expressions.ts` `groupPacks`).
23. **No `:shortcode:` expansion, no emoji autocomplete.**
    `EmojiIndex.expandShortcodes` (`EmojiIndex.kt:93-98`) has no call sites at
    all — R8 lists it under removed code in
    `android/app/build/outputs/mapping/release/usage.txt:69896`. Typing
    `:shrug:` on the phone sends the literal text. The web expands it and also
    offers a `:` autocomplete in the composer
    (`web/src/components/composer/Composer.tsx:24`).
24. **Category names are frozen at class init.** `EmojiIndex.GROUPS`
    (`EmojiIndex.kt:24-34`) is a `val` that calls `t(...)` when the object is
    first touched, so changing language does not retranslate them. The web uses
    a function (`emojiIndex.ts:58`).

### The data underneath (all of it already correct)

- `assets/emoji.tsv` — 1 906 rows, tab separated:
  `unicode, group, label, shortcodes, tags, skins`. 323 rows carry skin
  variants. Groups: 0 (169), 1 (386), 3 (159), 4 (131), 5 (218), 6 (85),
  7 (264), 8 (224), 9 (270). Read once on IO at `EmojiIndex.kt:44-69`.
  **There is no generator for this file** — nothing in `tools/` or the
  `Makefile` writes it, so it can drift from the web's emojibase set.
- `AppState.emojis: MutableStateFlow<Map<String, List<Emoji>>>`
  (`data/AppState.kt:69`), filled from READY at `data/Session.kt:650` and from
  gateway events at `Session.kt:467-480`.
- `AppState.stickerPacks: MutableStateFlow<List<StickerPack>>`
  (`AppState.kt:70`), filled at `Session.kt:651` / `Session.kt:487`.
  `StickerPack` (`net/Models.kt:263-277`) carries `kind`, `ownerUserId`,
  `serverId`, `coverStickerId`, `installed`, `updatedAt`, `stickers`.
- `SettingsStore` — the end-to-end encrypted, cross-device settings document.
  `skinTone` (`:148`), `recentEmoji` (`:150`), `rememberEmoji` (`:171-174`).
  Unknown fields are carried through untouched (`SettingsStore.kt:26-33`), so
  `favoriteGifs` survives on the phone today — it is simply never read.
- `ExpressionsApi` (`net/Endpoints.kt:290-333`) already has `gifStatus`,
  `gifSearch(q, pos)`, `gifTrending(pos)` with the paging cursor.
- `Media.emoji(blobId, size)` / `Media.sticker(blobId, size)`
  (`media/Media.kt:16,18`). The server serves an animated blob ≤ 512 px
  **unresized and still animated** (`internal/media/variants.go:85`), so a grid
  of animated custom emoji will animate every visible cell unless told not to.
- `Twemoji` (`media/Twemoji.kt`) — per-emoji SVG URLs plus an
  `available.json` index, the same naming rule as `web/src/lib/twemoji.ts`.
- Icons are generated: `tools/gen_lucide.py` from `tools/lucide_map.py`'s
  `MAP` into `ui/icons/Lucide.kt`. **`Clock`, `Cat`, `Pizza`, `Plane`,
  `Activity`, `Lightbulb`, `Leaf` and `Flag` are not in the set** — the eight
  icons the web's category rail uses (`EmojiPicker.tsx:23-34`).
- Strings come from the web catalogue, copied at build time by the
  `CopyLocales` task (`android/app/build.gradle.kts:20-43`) out of
  `web/src/i18n/locales/`. New strings are added there, not in Android.
- `MainActivity` uses `enableEdgeToEdge()` (`MainActivity.kt:68`), the manifest
  sets `windowSoftInputMode="adjustResize"` and `configChanges` includes
  `orientation|screenSize` (`AndroidManifest.xml:52-54`) — so **the activity is
  not recreated on rotation** and plain `remember` survives it.
- Compose BOM `2026.09.00`, Kotlin `2.4.20`, minSdk 26, Coil 3.6.2 with
  `coil-gif` and `coil-svg` (`android/app/build.gradle.kts:150,169,180-184`).

---

## What the web client does

One popover, three tabs, opened by one button.

### Shell — `web/src/components/pickers/ExpressionPicker.tsx`

`ExpressionPicker` (`:53`) is a `role="dialog"` box, 498 × 498 px, capped at
`70vh` (`Picker.module.css:1`). Below 768 px wide it becomes a bottom sheet:
`position: fixed; left/right: 0; bottom: 0; height: 60vh` with
`padding-bottom: env(safe-area-inset-bottom)` and top corners rounded
(`Picker.module.css`, `@media (max-width: 767px)`). **That mobile rule is the
thing Android should be building.**

- A tab row (`:87-92`): **GIFs · Stickers · Emoji**, plus a close ✕. A tab whose
  content was not passed is `disabled`, not hidden.
- `active` tab is local state seeded from a `tab` prop (`:54`), so the same
  component opens on any tab.
- Body swaps on the active tab (`:93`) — the three tab bodies are separate
  components and are **unmounted** when not shown.
- Dismissal: outside `mousedown` (`:64-70`) and Escape (`:71-77`), both careful
  to let a context menu or modal *opened from inside the picker* take the event
  first (`openedOver`, `:48-50`), and to ignore a click on the toggle button so
  it does not close-then-reopen.
- On a coarse pointer it blurs the composer on open (`:57-62`) so the software
  keyboard does not cover the picker.

### Emoji tab — `EmojiPicker.tsx`

Anatomy, top to bottom: **search row** (input + skin-tone button) → **body**
(48 px category rail on the inline-start edge | scrolling grid) →
**inspector** (40 px footer).

- **Sections** (`:266-287`), in order: *Frequently used* (recents, only when
  the query is empty), then one section per **server** with custom emoji
  (current server first, `:259-263`), then one per **emoji pack**
  (`packEmoji`, newest first), then the nine **unicode groups**. A query
  collapses all of it into one flat result list.
- **Search** (`:268-274`) queries three sources and concatenates them in this
  order: custom server emoji (≤ 40), pack emoji (≤ 40), unicode (≤ 100). Each
  has its own scorer. `searchEmoji` (`emojiIndex.ts:164-184`) scores
  shortcode-exact 100, label-exact 90, shortcode-prefix 80, label-prefix 70,
  shortcode-substring 40, label-substring 35, tag-prefix 30, and sorts
  descending. `searchCustomEmoji` / `searchPackEmoji` / `searchStickers`
  (`stores/expressions.ts`) use 100/80/40 on the name, plus 40 on a tag prefix
  and 20 on the pack name for stickers. Leading and trailing `:` are stripped
  from the query first.
- **Virtualisation** (`:289-304`, `:347-349`): the DOM has no lazy list, so it
  flattens sections into `Row`s of `cols` cells, computes each row's `top`,
  binary-searches the first visible row (`firstRowBelow`, `:213-224`) and
  renders that window ± 600 px of overscan. Cell 40 px, header 32 px.
- **Sticky header** (`:350-358`, `.stickyHead`): it walks *backwards* from the
  first visible row to the nearest header and paints that title in a pinned
  strip over the grid. Not CSS `position: sticky` on the real headers — an
  overlay. Android should copy this trick.
- **Category rail** (`:369-386`): recents clock, then pack covers, then server
  icons (falling back to initials), then the nine group icons. Clicking
  `jump()`s (`:342-345`) by setting `scrollTop` to that header's precomputed
  `top`.
- **Sprites** (`:91-96`, `emojiIndex.ts:201-219`): a cell is a `<span>` with a
  background-position into one of 14 WebP sheets (9 by group, 5 by skin tone;
  64 px cells, 2 px pad, 68 px pitch, 24 columns). Only when a picture is
  missing from the sheets does it fall back to a single SVG `<img>`.
  `tools/twemoji_sprites.py` generates them and its docstring explains why: one
  SVG per cell stalled fast scrolling for hundreds of milliseconds.
- **Skin tone** (`ToneSelector`, `:147-211`): a raised-hand button beside the
  search box opening a vertical `role="menu"` of six hands, with
  `aria-checked`, arrow-key movement, its own Escape handler that stops the
  event before the picker's, and focus returned to the button. Writes
  `settings.skinTone`.
- **Inspector** (`:117-138`): a footer naming what the pointer is over,
  `:shortcode:` style. Uses an external store (`createHover`, `:65-80`) so
  hovering does not rerender 2 000 cells.
- **Recents** are written as the **base** unicode (`:335`), capped at 40, and
  resolved back through a unicode map on read (`:279-280`).
- **Keyboard**: the search box takes focus on open only when
  `focusSearchOnOpen()` is true — i.e. **not** on a coarse pointer (`:19-21`),
  precisely so the software keyboard does not eat the sheet. Changing the query
  scrolls the grid back to the top (`:307-310`).
- **Loading / empty**: "Loading emoji…" while the dataset is in flight
  (`:388`), "No emoji match" on an empty result (`:389`, `:360`).

### GIF tab — `GifPicker.tsx` + `GifGrid.tsx`

- Two chips (`:122-125`): **Favourites** and **Trending**/**Results**.
  Favourites always exist; the search input and the second chip appear only
  when the instance has a provider. If there is a provider and no favourites,
  it opens on search (`:53-55`).
- `gifEnabled` is `null` until `gifStatus()` answers (`:45-51`), cached in the
  store so it is asked once per session.
- **Debounce 300 ms** on a non-empty query, 0 for empty (`:90-98`), with a
  monotonically increasing `seq` guard so a slow earlier response cannot
  overwrite a newer one (`:58`, `:64`, `:78`).
- **Paging** (`:57-88`, `:100-104`): `page.next` is the cursor; a second page is
  de-duplicated against what is shown, because trending shifts under you
  (`:68-72`); an empty page ends paging even if the provider offers another
  cursor (`:75`). `GifGrid` calls `onNearEnd` when the bottom is within 800 px
  (`GifGrid.tsx:28`, `:91-94`).
- **Masonry** (`GifGrid.tsx:79-89`): two columns, 8 px gap, heights from
  `w`/`h` when known and learnt from `naturalWidth/Height` on load when not
  (`:96-104`). Only tiles within ±600 px of the viewport are in the DOM
  (`KEEP_PX`, `:89`) and the window moves in 100 px steps (`STEP_PX`, `:60`)
  so it does not rebuild on every pixel.
- **Favourites** (`lib/gifFavorites.ts`): `{url, w?, h?}[]` in the shared
  settings document, max 500, newest first. A star overlay on hover, a long
  press / right click context menu with Send and Add/Remove, and — on touch —
  the star is hidden unless already set, because an invisible corner button
  steals taps (`Picker.module.css`, `@media (hover: none)`).
- **Dead favourites** (`:38-40`, `:127-152`): a favourite whose provider is
  gone fails to load, is marked `dead`, shows "this one is gone" instead of a
  broken box, and the footer offers to remove them all at once.
- **States**: no provider → "GIF search is off on this server" note and only
  the Favourites chip; empty favourites → "No favourites yet" + where to star
  one; empty results → "No GIFs match" vs "Nothing trending right now"
  depending on whether there was a query; a failed *next* page → "More GIFs
  could not be loaded" + Try again, which keeps what is already shown; and an
  attribution line once results exist.

### Sticker tab — `StickerPicker.tsx`

Search row, then rail | grid. Packs grouped by `groupPacks`: **This server →
My packs → Installed → Other servers**, each pack appearing once
(`expressions.ts`). Cells ~96 px in an `auto-fill` grid, images requested at
100 px rather than the 160 px a message uses (`:42-47`). Rail shows each pack's
cover sticker, or its initial. A pack section carries
`content-visibility: auto` with an estimated `containIntrinsicSize` so an
off-screen pack is neither laid out nor painted. A pack header offers Edit (if
you own it) and Remove (if you may), also on long press. Search flattens to one
grid; empty → "No stickers match"; no packs at all → "No sticker packs yet" +
a link into settings.

### How the composer opens it

One button. `web/src/components/composer/Composer.tsx:503` — a single `Smile`
`iconBtn` that toggles `picker`, marked `data-picker-toggle` while open so the
outside-click handler ignores it. `:437-446` renders one `ExpressionPicker`
and hands it `gifs` and `stickers` as ready-made nodes. Emoji insert into the
draft and **the picker stays open**; a GIF or a sticker sends immediately and
closes it. Escape closes the picker before it clears a reply (`:403`).

---

## The design

One `ExpressionSheet`. One button in the composer. Three tabs. The reaction
path opens the same sheet in a restricted mode.

### 1. Files and component tree

Replace `ui/pickers/Pickers.kt` with a package:

```
ui/pickers/
  ExpressionSheet.kt        the ModalBottomSheet shell, tab row, pager, footer
  ExpressionState.kt        @Stable state holder: tab, query, gif paging, sections
  EmojiTab.kt               rail + grid + sticky header + tone menu
  GifTab.kt                 chips + staggered grid + paging + favourites
  StickerTab.kt             rail + grouped grid
  EmojiIndex.kt             kept, fixed (see below)
  EmojiSprites.kt           new: sheet decode, LRU, cell painter
  cells/ExpressionCells.kt  EmojiCell, CustomEmojiCell, StickerCell, GifCell
```

Tree:

```
ExpressionSheet(target, serverId, initialTab, onEmoji, onSticker, onGif, onDismiss)
└ ModalBottomSheet(
    sheetState  = rememberModalBottomSheetState(skipPartiallyExpanded = false),
    containerColor = colors.bgFloating,
    contentWindowInsets = { WindowInsets(0) },     // we place insets ourselves
    dragHandle  = { BottomSheetDefaults.DragHandle() },
    sheetMaxWidth = 560.dp)                         // tablets: do not stretch
  └ Column(Modifier.fillMaxWidth().height(sheetHeight))
    ├ ExpressionTabRow                     // reaction mode: a title row instead
    ├ SearchRow(query, onQuery, trailing = { SkinToneButton() } on Emoji)
    ├ HorizontalPager(pagerState, Modifier.weight(1f),
    │                 beyondViewportPageCount = 0, userScrollEnabled = !reactionMode)
    │   ├ 0 EmojiTab
    │   ├ 1 GifTab
    │   └ 2 StickerTab
    ├ ExpressionFooter                     // Emoji: preview; Gif: attribution
    └ Spacer(Modifier.windowInsetsBottomHeight(
              WindowInsets.navigationBars.union(WindowInsets.ime)))
```

`HorizontalPager` (not a `when`) so a swipe moves between tabs, which is what
makes it feel like one thing rather than three. `beyondViewportPageCount = 0`
keeps only the visible tab composed — three grids alive at once is the only way
this gets slow.

### 2. Where state lives

| State | Where | Why |
| --- | --- | --- |
| `tab` | `rememberSaveable` in `ExpressionSheet`, driven through `PagerState` | survives process death; rotation is already safe (`configChanges`) |
| `query` | `rememberSaveable` **per tab** (`Array<String>(3)`) | each tab keeps its own search, as the web does by unmounting |
| grid scroll | `rememberLazyGridState()` per tab, hoisted into `ExpressionState` so a tab swipe does not reset it | |
| emoji sections | `ExpressionState.sections: State<List<Section>>`, recomputed off the main thread | see §8 |
| GIF results, cursor, loading, error | `ExpressionState.gif` | survives a tab swipe |
| `skinTone`, `recentEmoji`, `favoriteGifs` | `SettingsStore`, **exposed as flows** | see §5 |
| custom emoji, packs | `AppState.emojis` / `AppState.stickerPacks`, `collectAsState()` | already correct |
| `gifEnabled` | `AppState.instance.value?.gifSearch`, confirmed once by `ExpressionsApi.gifStatus()` into a new `AppState.gifEnabled: MutableStateFlow<Boolean?>` | no request on open |

`ExpressionState` is a plain `@Stable class` built by
`rememberExpressionState(serverId, mode)`; the app has no ViewModels and should
not grow one for this.

### 3. The sheet's anatomy on a phone

- **Height.** `sheetHeight = (screenHeight * 0.62f).coerceIn(380.dp, 560.dp)`
  measured with `LocalWindowInfo`/`BoxWithConstraints`, not a hard 460 dp. The
  web uses `60vh`; 62 % leaves the last two message rows visible above it.
- **Expansion.** `skipPartiallyExpanded = false`. The sheet opens at
  `PartiallyExpanded` (= `sheetHeight`) and a drag up takes it to `Expanded`
  (full height minus status bar). Expanded is what you want when the keyboard
  is up or you are scrolling the whole unicode set. The `Column` uses
  `Modifier.heightIn(min = sheetHeight)` + `fillMaxHeight()` so it grows with
  the sheet rather than leaving a gap.
- **Keyboard.** The manifest is already `adjustResize` and the activity is
  edge-to-edge, so `WindowInsets.ime` is live. The sheet must **not** use
  `Modifier.imePadding()` on the whole column — that would shrink the grid and
  fight `ModalBottomSheet`'s own animation. Instead:
  `contentWindowInsets = { WindowInsets(0) }` on the sheet, and the single
  bottom `Spacer` above consumes `navigationBars ∪ ime`. When the IME opens,
  the grid loses height and the search row stays visible directly above it,
  which is the Discord behaviour.
- **Focus.** The search field takes focus **only** when the tab is Sticker or
  Gif *and* the person tapped the field. It must **not** autofocus on open —
  this is the Android form of `focusSearchOnOpen()`
  (`EmojiPicker.tsx:19-21`): a coarse pointer never autofocuses, because the
  keyboard would cover the grid. Opening the sheet also calls
  `LocalSoftwareKeyboardController.current?.hide()` so the composer's keyboard
  goes down.
- **Dismissal.** The scrim tap and the drag-down both hit
  `onDismissRequest`. Back is handled by `ModalBottomSheet` already; add a
  `BackHandler` *inside* the sheet only for the tone menu, so Back closes the
  tone menu first and the sheet second — the Android form of the web's Escape
  ordering (`EmojiPicker.tsx:159-166`).
- **Rotation.** `configChanges` covers `orientation|screenSize`, so nothing is
  recreated and every `remember` survives; `rememberSaveable` covers the
  "don't keep activities" case. On landscape the height formula collapses to
  the 380 dp floor, so the tab row, search row, grid and footer must all fit in
  380 dp — they do (48 + 52 + grid + 40).
- **RTL.** No `Modifier.padding(start=…)` anywhere; use
  `PaddingValues(horizontal=)` or `start/end` which are already
  direction-aware in Compose. The category rail sits at the *inline start*,
  which `Row` gives for free under `LocalLayoutDirection.Rtl`
  (already provided at `MainActivity.kt:101`). The GIF staggered grid, the tab
  row and the pager all mirror automatically. **The one thing that does not**:
  `HorizontalPager` page indices do not flip, so in RTL page 0 is still Emoji
  but sits on the right — which is correct and matches the tab row.

### 4. Tab row

`SecondaryTabRow` (M3) with three `Tab`s: **Emoji · GIFs · Stickers**, in that
order (the web lists GIFs first on desktop; on a phone Emoji is the common case
and should be the leftmost/default). Selected tab uses `colors.bgSelected` /
`colors.textStrong`; the rest `colors.textMuted`, matching
`Picker.module.css .tab`.

A tab is **disabled, not hidden**, when its content cannot exist — GIFs when
`instance.gifSearch` is false *and* there are no favourites, Stickers when
there are no packs at all — exactly as `ExpressionPicker.tsx:88-89` does. A
disabled tab still tells you the feature exists. Tapping it shows the tab's
empty state rather than doing nothing, so prefer enabled-with-empty-state and
reserve disabled for "your instance turned this off".

### 5. Settings that must become flows

`SettingsStore` already holds a `_doc: MutableStateFlow<JsonObject>`. Add
derived flows so Compose recomposes:

```kotlin
val recentEmojiFlow: StateFlow<List<String>>          // map over doc
val skinToneFlow: StateFlow<Int>
val favoriteGifsFlow: StateFlow<List<FavoriteGif>>    // new, {url,w,h}
fun setSkinTone(tone: Int)
fun toggleFavoriteGif(url: String, w: Int, h: Int)    // cap 500, newest first
```

And **fix `rememberEmoji` to match the web**: store the *base* unicode for a
unicode emoji, never the toned form. Custom emoji need a recents list the
browser will not eat — keep them in a separate `recentCustomEmoji` key holding
`<a?:name:blob>` tokens, so `recentEmoji` stays exactly the shape
`EmojiPicker.tsx:279-280` expects and the two clients stop overwriting each
other. The picker's Recent section shows `recentCustomEmoji` then
`recentEmoji`, both capped at 40.

### 6. Emoji tab

```
Row(Modifier.fillMaxSize())
 ├ CategoryRail(width = 44.dp)              // LazyColumn, scrollbar hidden
 └ Box(Modifier.weight(1f))
    ├ LazyVerticalGrid(state, GridCells.Fixed(cols), contentPadding = 8.dp)
    └ StickyCategoryHeader(overlaid at the top)
```

- **Columns.** `BoxWithConstraints`; `cols = floor((maxWidth - 16.dp) / 46.dp)`
  clamped to 6…10. `GridCells.Fixed(cols)` rather than `Adaptive`, so the
  header span and the jump indices are computable.
- **Cell.** 46 dp box, 30 dp picture (unchanged from today, and a hair under
  Material's 48 dp guidance — a deliberate, documented exception that every
  emoji grid makes; the grid's 8 dp content padding gives the edge rows slop).
  `Modifier.clickable(onClickLabel = shortcode)` and a
  `semantics { contentDescription = ":shortcode:" }`.
- **Sections**, matching the web's order exactly: *Frequently used* → one
  section per **server** with custom emoji, current server first, named after
  the server → one per **emoji pack** (newest `updatedAt` first, **with no
  `installed` filter**, fixing item 19) → the nine unicode groups.
- **Headers** are `item(span = { GridItemSpan(maxLineSpan) })`, 32 dp,
  uppercase, `colors.textMuted`.
- **Sticky header.** Do not rely on `LazyGridScope.stickyHeader` (experimental
  in foundation, and it only pins a *grid* header, not a full-span item you
  built yourself). Copy the web: keep a sorted `IntArray` of header item
  indices plus their titles, then

  ```kotlin
  val stickyTitle by remember {
      derivedStateOf {
          val first = gridState.firstVisibleItemIndex
          headerTitles[headerIndices.binarySearchFloor(first)]
      }
  }
  ```

  and draw it as a `Text` in a `Box` aligned `TopStart` over the grid, with
  `colors.bgFloating` behind it. `derivedStateOf` means it recomposes only when
  the *section* changes, not on every scrolled pixel.
- **Category rail.** A `LazyColumn`, 44 dp wide, `colors.borderSubtle` divider
  on its inline end: a clock for recents, each emoji pack's first sticker,
  each server's icon (or `initials()` on a coloured circle), then nine group
  icons. Tap → `scope.launch { gridState.animateScrollToItem(headerIndex) }`.
  The rail highlights the section currently under the sticky header
  (`data-selected` equivalent) and `animateScrollToItem`s itself to keep the
  active chip visible.
  **The eight missing icons** (`Clock`, `Cat`, `Pizza`, `Plane`, `Activity`,
  `Lightbulb`, `Leaf`, `Flag`) must be added to `tools/lucide_map.py` and
  `tools/gen_lucide.py` rerun — do not hand-edit `Lucide.kt`, its header says
  so.
- **Footer / preview.** The web's inspector is hover-driven and a phone has no
  hover. Replace it with a **press preview**: while a cell is held
  (`interactionSource.collectIsPressedAsState()`), the 40 dp footer shows the
  emoji at 28 dp and its `:shortcode:`. Released with no drag → pick. This
  gives the same "what am I about to send" answer that the web's hover gives,
  and costs nothing when nothing is pressed. When idle the footer shows the
  active category name, or, in reaction mode, "Tap an emoji to react".
- **Skin tone.** A hand button at the end of the search row, showing
  `HANDS[tone]` (`✋` plus the five modifiers, as `EmojiPicker.tsx:141`).
  Tapping opens a `DropdownMenu` anchored to it with six items, each a hand
  drawn through the sprite/Twemoji path, `selected` ring on the current one,
  `Role.RadioButton` semantics and the tone's translated name as the content
  description. Writes `SettingsStore.setSkinTone`. **This is new functionality
  on Android** — today there is no way to set it at all.
- **Behaviour on pick.** Compose mode: insert the token at the caret and
  **leave the sheet open** (fixing item 5); the composer's caret advances, the
  keyboard stays down. Reaction mode: react and dismiss.
- **A new query scrolls the grid to item 0** (`EmojiPicker.tsx:307-310`).

### 7. Search, per tab

| Tab | Searches | Ranking | No results |
| --- | --- | --- | --- |
| Emoji | custom server emoji names, pack emoji names, unicode shortcodes + labels + tags | one flat list: custom (≤40) then pack (≤40) then unicode (≤100), each scored as `emojiIndex.ts:164-184` / `expressions.ts` — exact 100, label-exact 90, prefix 80, label-prefix 70, substring 40, label-substring 35, tag-prefix 30 | "No emoji match" + the query, and, if the query has no `:`, a hint that `:name:` also works |
| Sticker | sticker name, then its `tags` (space separated, prefix), then the pack name | 100 / 80 / 50 name, 40 tag-prefix, 20 pack-name, cap 60 | "No stickers match" |
| GIF | the provider's own search | the provider's order, unchanged | "No GIFs match" with a query, "Nothing trending right now" without |

Both `:` and a leading/trailing `:` are stripped before matching, so pasting
`:joy:` works.

`EmojiIndex.search` must be rewritten to the web's scoring (today
`EmojiIndex.kt:77-90` is a two-bucket starts/contains split that breaks out of
the loop early and so can return a worse match while a better one exists later
in the file). And it must run **off the composition**:

```kotlin
val results by produceState(emptyList(), query) {
    delay(80)                                   // coalesce fast typing
    value = withContext(Dispatchers.Default) { EmojiIndex.search(query) }
}
```

### 8. Emoji that need special handling

- **Skin tone.** Applied at draw and at pick through `EmojiIndex.withTone`
  (`EmojiIndex.kt:101-102`), which is already correct. 323 of 1 906 entries
  have variants. Recents store the **base**; the picker draws them toned. A
  base with no variant for the chosen tone falls back to itself.
- **Custom server emoji.** One section per server, named, current server
  first, server icon in the rail. The token `<a?:name:blobId>` carries the
  *blob* id, so — as `expressions.ts` `emojiToken` spells out — **it renders
  for everyone, everywhere, including people not in that server.** There is
  therefore **no "emoji you cannot use" state in this product**; do not build
  one, and do not grey anything out. The only failure is a blob that has since
  been deleted: the cell's image 404s, so a recents entry that fails to load is
  dropped from the recents list on failure rather than left as a grey box.
- **Emoji packs.** `kind == "emoji"` packs, **no `installed` filter** (matching
  the web), newest `updatedAt` first. Picked as `<a?:name:blobId>` — the same
  token shape as a server emoji, so nothing downstream changes.
- **Animated emoji.** `internal/media/variants.go:85` returns an animated blob
  ≤ 512 px untouched, so a grid of them would animate every visible cell and
  hold N `AnimatedImageDrawable`s. In the picker, request **the still first
  frame**: build the `ImageRequest` with a non-animating decoder
  (`coil3.decode.StaticImageDecoder.Factory()` on API ≥ 28, plain
  `BitmapFactoryDecoder` below, which also yields frame 0) and give the request
  a distinct `memoryCacheKey` suffix (`"$blobId@still"`) so it does not collide
  with the animated copy the message list wants. Draw a small "GIF"-style
  corner dot on animated cells, as Discord does, so it is clear the emoji moves
  when sent. The **footer preview animates** — one animated drawable at a time
  is fine, and it is the answer to "what does this actually look like".
- **Sticker packs not installed.** There is no such thing to hide: every pack
  in `AppState.stickerPacks` is one you own, have installed, or share a server
  with (`Session.kt:651`). Group them, do not filter them (item 19).

### 9. Reaction mode

The same composable, one parameter: `mode: ExpressionMode` with
`Compose` and `Reaction(channelId, messageId)`.

Differences, and only these:

1. **No tab row.** In its place a 48 dp title row: "React" on the inline start
   and the message author's name muted on the end. GIFs and stickers are not
   reactions in this product (`MessageService.react` takes a string key), so
   they are absent rather than disabled.
2. **The pager is locked** to page 0 (`userScrollEnabled = false`).
3. **Quick row.** Above the search field, the six-emoji quick row that lives in
   `MessageActions.kt:84-100` today moves here: four recents + `QUICK`,
   distinct, capped at six, at 30 dp. It then *belongs* to the picker and can
   be reused anywhere a reaction is added.
4. **One pick closes it.** The value handed to `onEmoji` is a **reaction key**,
   not a composer token: the plain unicode for a unicode emoji, and
   `a?:name:blobId` (no angle brackets) for a custom one. Put that conversion
   in one place — `Expressions.reactionKey(pick)` — instead of the regex at
   `MessageActions.kt:157-159`.
5. **Footer** reads "Tap an emoji to react" when idle.
6. **`MessageActions` dismisses itself first.** Today it stacks a second sheet
   on the first (`MessageActions.kt:151`). Instead `MessageActions` calls
   `onOpenReactionPicker(message)` and closes; `ChatScreen` owns a single
   `reactingTo: UiMessage?` beside its existing `actionsFor`, and renders
   `ExpressionSheet(mode = Reaction(...))` at the same level as
   `MessageActions` (`ChatScreen.kt:181-190`). One sheet at a time, always.
7. **Add a second entry point** while you are here: a `+` chip at the end of
   `MessageRow.kt:277-317`'s reaction row when the person may react, opening
   the same sheet. Long-pressing a message to add a reaction is not
   discoverable.

### 10. GIF tab

```
Column(Modifier.fillMaxSize())
 ├ Row of two chips: [Favourites] [Trending | Results]
 └ LazyVerticalStaggeredGrid(Fixed(2), state, verticalItemSpacing 6.dp,
                             horizontalArrangement spacedBy(6.dp))
     items(tiles, key = { it.key }, contentType = { "gif" }) { GifTile }
     item(span = FullLine) { GifFooter }
```

- **Provider.** `AppState.instance.value?.gifSearch` answers immediately — the
  instance payload already carries it (`net/Models.kt:566`), so unlike the web
  the phone needs **no** `gifStatus()` round trip before drawing. Confirm it
  once per session in the background and cache in
  `AppState.gifEnabled: MutableStateFlow<Boolean?>`; if the two disagree, trust
  `gifStatus`.
- **No provider configured.** The Favourites chip stands alone, the search
  field is not drawn, and a muted note reads "GIF search is off on this
  server." — never shown for a network error (fixing item 17). With no
  favourites either, the empty state explains where a favourite comes from.
- **Trending and search.** Empty query → `gifTrending(pos)`; non-empty →
  `gifSearch(q, pos)`. **Debounce 300 ms** on a non-empty query, 0 on empty
  (`GifPicker.tsx:93`), implemented as `snapshotFlow { query }.debounce(300)
  .mapLatest { … }` — `mapLatest` gives the `seq` guard for free.
- **Paging.** Keep `page.next`. Load more when the last visible index is within
  8 tiles of the end, via
  `snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }`.
  De-duplicate a new page against the ids already shown (trending shifts under
  you), and treat an empty page as the end even if a cursor came back.
- **Tiles.** `aspectRatio((w/h).coerceIn(0.5f, 2f))`, defaulting to 1.3 when
  the provider gave no size — the shape today's code already computes
  (`Pickers.kt:251`) and worth keeping. Preview first, full URL as the
  fallback. Request the **preview** with the animated decoder *on* (a still GIF
  grid is a worse experience than a moving one, and there are only ~8 tiles on
  screen), but cap it: pause animation for tiles that scroll out by keying
  the request to visibility, and disable animation entirely when
  `SettingsStore.reducedMotion` is set (`SettingsStore.kt:146`) — that setting
  exists and nothing honours it here.
- **Favourites.** New on Android, reading and writing the same shared
  `favoriteGifs` array the web uses. A star in the tile's top-inline-end corner
  which, following `Picker.module.css`'s `@media (hover: none)` rule, is drawn
  **only when the GIF is already a favourite**; adding one is a long press →
  a small menu with Send and Add to favourites. Dead favourites (image fails)
  render "This one is gone" and the footer offers "Remove them".
- **Footer**: a spinner while loading; "No GIFs match"/"Nothing trending right
  now" when empty; "More GIFs could not be loaded — Try again" on a failed
  *next* page, keeping what is already on screen; and the provider attribution
  once there are results.
- **Picking** sends immediately and dismisses, as today (`Composer.kt:341-351`).

### 11. Sticker tab

```
Row
 ├ PackRail(width = 44.dp)      cover sticker or initial, per pack
 └ LazyVerticalGrid(GridCells.Fixed(cols), cols from floor(width / 96.dp) in 3..5)
     group header ("This server" / "My packs" / "Installed" / "Other servers")
     pack header  (name, + "Edit"/"Remove" when allowed — see below)
     sticker cells 96 dp, picture 84 dp, requested at Media.sticker(blob, 160)
```

Grouping is `groupPacks` from `expressions.ts`, ported verbatim: **This server
→ My packs → Installed → Other servers**, each pack once, `updatedAt`
descending within a group. Search flattens to a single grid.

Android has **no sticker settings page** (`ui/settings/SettingsScreen.kt:97-114`
has no `"stickers"`), so the web's Edit/Remove pack affordances and its
"Create or install a pack" link have nowhere to go. Two honest options, in
order of cost:

- **Now**: the empty state reads "No sticker packs yet." with a second line
  "Packs you install, or that come with your servers, show up here." — no dead
  link. Long-pressing a pack in the rail offers only "Remove from your packs"
  when `installed`, wired to the `ExpressionsApi.install(id, false)` call that
  already exists (`net/Endpoints.kt:307`).
- **Later**: a `Route.Settings("stickers")` page. Out of scope here.

Picking sends immediately and dismisses, as today (`Composer.kt:356-369`).

### 12. Performance

The numbers: **1 906 unicode cells** across 9 sections, plus custom emoji and
pack emoji, plus 9–20 headers. At 46 dp cells on a 411 dp phone that is 8
columns, ~238 rows of unicode, ~60 cells visible at once.

- **`LazyVerticalGrid` composes only what is visible** — unlike the DOM, which
  is why `EmojiPicker.tsx` hand-rolls virtualisation with `firstRowBelow`
  binary searches. **Do not port the virtualisation.** One `items()` per
  section with a stable `key` and a shared `contentType` is both idiomatic and
  faster. Keys: `"u:$unicode"`, `"c:${emoji.id}"`, `"p:${sticker.id}"`,
  `"r:$index:$token"` for recents (so a recent that is also in a group does not
  collide).
- **The sections list is built once, off the main thread.** A
  `snapshotFlow` over `(query, tone, emojis, packs, recents, serverId)` →
  `Dispatchers.Default` → a `List<Section>` of *pre-resolved* cells. Today
  `Pickers.kt:139` calls `EmojiIndex.group(id)` — a 1 906-element `filter` —
  nine times **inside the grid's content lambda**, on every recomposition.
  Replace `EmojiIndex.group()` with a `Map<Int, List<EmojiEntry>>` built once
  in `EmojiIndex.load`.
- **Pictures: adopt the web's sprite sheets.** This is the big one.
  `tools/twemoji_sprites.py` already produces 14 WebP sheets in
  `web/src/assets/twemoji-sprites/` — 9 by group (≈2.2 MB total) and 5 by skin
  tone (≈2.0 MB) — with `index.json` giving `cell 64, pad 2, pitch 68, cols 24`
  and a `hexcode → [sheet, slot]` map. Add a gradle `CopySprites` task beside
  `CopyLocales` (`android/app/build.gradle.kts:20-43`) that copies the sheets
  and `index.json` into the app's assets.
  - **Decode lazily, one sheet at a time**, in an LRU of 3
    (`g1` is 1632 × 1088 ≈ 7 MB as ARGB_8888; all nine at once would be
    ~37 MB — too much). `BitmapFactory.decodeStream(assets.open(...))` on
    `Dispatchers.Default`, wrapped in a `MutableState<ImageBitmap?>` per sheet;
    a cell whose sheet is not yet decoded draws nothing for a frame, and the
    sheet arrives in one go rather than 200 separate images.
  - **A cell draws a sub-rectangle**, not an image:
    `Modifier.drawWithCache { onDrawBehind { drawImage(sheet, srcOffset =
    IntOffset(col*68+2, row*68+2), srcSize = IntSize(64,64), dstSize = …) } }`.
    No per-cell allocation, no decode, no network.
  - **Fall back exactly as the web does** (`EmojiPicker.tsx:93-96`): an emoji
    not in the sheets uses the existing `TwemojiImage` SVG path, and a device
    with no sprite assets falls back wholesale. Nothing regresses.
  - This removes **~1 900 HTTP requests and ~1 900 SVG rasterisations** from a
    full scroll and replaces them with at most 3 WebP decodes.
- **Custom and pack emoji** stay on Coil with `Media.emoji(blob, 64)`, still
  frame (§8), `contentType = "custom"` so the grid recycles them separately
  from sprite cells.
- **APK cost**: +4.2 MB for all fourteen sheets, or +2.2 MB if the five tone
  sheets are fetched from the instance on first use. Ship the nine base sheets
  and fetch tone sheets lazily — 95 % of people never leave the default tone.
  (Serving them needs a stable path: `web/vite.config.ts:41-49` already copies
  `/twemoji/` into `dist`, and `internal/api/static.go:60` already whitelists
  that prefix, so `dist/twemoji/sprites/*` would be reachable with a two-line
  change to the vite plugin.)
- **GIF tab**: only the ~8 visible tiles hold decoded frames, because
  `LazyVerticalStaggeredGrid` disposes the rest — the web needed `KEEP_PX` for
  the same reason it needed row virtualisation. Cap `beyondViewportPageCount`
  at 0 so the GIF tab is not decoding frames while you are on Emoji.
- **The footer preview must not rerender the grid.** Use an
  `InteractionSource`-driven `MutableState` read **only** by the footer — the
  Android form of the web's `createHover` external store
  (`EmojiPicker.tsx:65-80`).

### 13. Accessibility

- Every cell: `contentDescription = ":shortcode:"` for emoji (the label a
  screen reader can actually say), the sticker's name for a sticker, the GIF's
  title (or "GIF") for a GIF. `Role.Button`.
- Headers: `semantics { heading() }`, so TalkBack's heading navigation walks
  the categories.
- Category rail buttons: `contentDescription` = the category name, `Role.Tab`,
  `stateDescription` = selected.
- Tone menu: `Role.RadioButton` per item, `selected = i == tone`, each labelled
  with the translated tone name — the web already has these strings
  (`pickers.emojiPicker.toneDefault` … `toneDark`).
- Tab row: `SecondaryTabRow` gives the tab semantics; add the tab's name.
- The sheet: `semantics { paneTitle = t("pickers.expressionPicker.expressionPicker") }`
  — the string exists (`ExpressionPicker.tsx:86`).
- Touch targets: 46 dp cells are below the 48 dp guideline; document it, and
  make the rail buttons, chips, tabs and tone items a full 48 dp.
- RTL: covered in §3. Everything positional must be `start`/`end`, and the
  sticky-header overlay must be `Alignment.TopStart`, not `TopLeft`.

### 14. Empty and error states, per tab

| Tab | State | What it shows |
| --- | --- | --- |
| Emoji | dataset loading | a centred spinner and "Loading emoji…" (the string exists) |
| Emoji | dataset failed to parse | the unicode sections are absent; custom and pack emoji still work, and a muted line says emoji could not be loaded. **Today the sheet spins forever** — `Pickers.kt:71-74` sets `ready = true` unconditionally but `EmojiIndex.load`'s `runCatching` swallows the failure, leaving an empty grid with no explanation |
| Emoji | no results | "No emoji match" |
| Emoji | no recents | the Recent section and its rail icon are simply absent |
| GIF | provider off | "GIF search is off on this server." Favourites chip only |
| GIF | provider on, first load | spinner |
| GIF | no results, with query | "No GIFs match" |
| GIF | no results, no query | "Nothing trending right now" |
| GIF | next page failed | keep what is shown; footer "More GIFs could not be loaded — Try again" |
| GIF | first page failed (network) | "Could not reach the server — Try again". **Distinct from "off on this server"** |
| GIF | no favourites | "No favourites yet" + how to star one (different text depending on whether search exists) |
| GIF | dead favourites | per-tile "This one is gone"; footer "N favourites no longer load — Remove them" |
| Sticker | no packs | "No sticker packs yet." + "Packs you install, or that come with your servers, show up here." |
| Sticker | no results | "No stickers match" |
| Sticker | an empty pack | the pack header with "This pack is empty" under it |
| All | not connected | the sheet still opens; emoji work offline once the sprites are bundled, GIFs show the network error |

Every string above already exists in `web/src/i18n/locales/en.json` under
`pickers.*`, because the web client shows the same states. New strings
(`Packs you install…`, `Could not reach the server`, `Tap an emoji to react`)
go into the web catalogue first — `CopyLocales` picks them up.

---

## Implementation plan

Nine steps. Each one compiles and ships on its own.

**1 — Settings become flows and stop fighting the web.** *(small, ~1 h)*
`data/SettingsStore.kt`: add `recentEmojiFlow`, `skinToneFlow`,
`favoriteGifsFlow`, `setSkinTone`, `toggleFavoriteGif`, `recentCustomEmoji`;
change `rememberEmoji` to store base unicode only and route custom tokens to
`recentCustomEmoji`. No UI change yet. *Risk: the settings document is shared
and encrypted; a wrong shape silently corrupts the web's recents. Write a unit
test that round-trips a doc written by the web fixture.*

**2 — `EmojiIndex` correctness and cost.** *(small, ~1 h)*
`ui/pickers/EmojiIndex.kt`: build a `Map<Int, List<EmojiEntry>>` in `load` and
make `group(id)` a lookup; rewrite `search` to the web's scoring
(`emojiIndex.ts:164-184`); make `GROUPS` a **function** so it follows the
language; surface a `loadFailed` flag; wire `expandShortcodes` into
`MessageService.send` so `:shrug:` finally works. *Low risk; add unit tests
comparing a handful of queries against the web's expected order.*

**3 — Icons.** *(tiny, ~20 min)*
Add `Clock, Cat, Pizza, Plane, Activity, Lightbulb, Leaf, Flag` to
`tools/lucide_map.py`; rerun `tools/gen_lucide.py`. Never hand-edit
`ui/icons/Lucide.kt`.

**4 — Sprite sheets.** *(medium, ~half a day, highest risk)*
`android/app/build.gradle.kts`: a `CopySprites` task mirroring `CopyLocales`,
copying `web/src/assets/twemoji-sprites/{g*.webp,index.json}` into the assets.
New `ui/pickers/EmojiSprites.kt`: parse `index.json`, decode a sheet on demand,
LRU of 3, expose `spriteFor(text, tone): SpriteRef?` and a
`Modifier.drawSprite(ref, size)`. Wire it into the *existing*
`EmojiCell`/`TwemojiImage` with the SVG path as the fallback, so it can be
verified against today's picker before anything is restructured. *Risk: memory.
Watch `Debug.getNativeHeapAllocatedSize` on a low-end device; if three sheets
is too much, drop the LRU to 2 or downsample `g1` — do not decode all nine.*

**5 — The shell.** *(medium, ~half a day)*
New `ui/pickers/ExpressionSheet.kt` + `ExpressionState.kt`: the
`ModalBottomSheet`, tab row, search row, `HorizontalPager`, footer, insets,
sizing, back handling, reaction mode. The three tab bodies start as thin
wrappers around today's grid code so the shell can be seen working before the
tabs are rewritten.

**6 — Emoji tab.** *(large, ~1 day)*
New `ui/pickers/EmojiTab.kt`: sections built off-thread, category rail, sticky
header overlay, tone menu, press preview, per-server custom sections, pack
emoji without the `installed` filter, still-frame animated cells. *Risk: the
sticky-header overlay and the rail's jump indices must agree; get them from one
precomputed structure, never computed twice.*

**7 — GIF tab.** *(medium, ~1 day)*
New `ui/pickers/GifTab.kt`: chips, debounce, paging with de-duplication,
favourites, dead-favourite handling, the six distinct empty/error states,
`instance.gifSearch` as the provider answer. Add
`AppState.gifEnabled`. *Risk: paging and debounce interact badly — a cursor
from an old query must never append to a new one. `mapLatest` plus a
`shownFor` marker, exactly as `GifPicker.tsx:34/64/78` does it.*

**8 — Sticker tab.** *(small, ~3 h)*
New `ui/pickers/StickerTab.kt`: port `groupPacks`, pack rail, grouped grid,
tag search, long-press remove.

**9 — Wire it up and delete the old.** *(small, ~2 h)*
- `ui/chat/Composer.kt`: **one** button — `Lucide.Smile`, always present,
  opening `ExpressionSheet(initialTab = Emoji)`. Delete the `Lucide.Sticker`
  button and the `if (value.text.isBlank() && staged.isEmpty())` branch at
  `:315` so Send gets its own slot and GIFs/stickers never disappear. Emoji
  insert and keep the sheet open.
- `ui/chat/MessageActions.kt`: delete the nested `EmojiPickerSheet` at
  `:151-162` and the regex at `:157-159`; call
  `onOpenReactionPicker(message)` and dismiss. Keep the quick row, or move it
  into the sheet (§9.3) and leave `MessageActions` to its menu rows.
- `ui/chat/ChatScreen.kt`: a `reactingTo` state beside `actionsFor`, rendering
  `ExpressionSheet(mode = Reaction(...))`.
- `ui/chat/MessageRow.kt`: a `+` chip at the end of the reaction row.
- **Delete `ui/pickers/Pickers.kt`.**

**Honest size.** Roughly **1 100–1 400 lines of new Kotlin**, about 330 deleted,
touching 9 files and adding 6. **Four to five focused days** for someone who
knows this codebase, of which the sprite work (step 4) and the emoji tab (step
6) are more than half. Steps 1–3 are an afternoon and are worth landing first
regardless, because they are bug fixes that stand alone.

---

## Risks

1. **The shared settings document.** `recentEmoji`, `skinTone` and
   `favoriteGifs` are written by the web, the desktop app and the phone into
   one encrypted blob. The phone is **already** corrupting `recentEmoji` by
   writing toned unicode and `<:name:blob>` tokens the web discards
   (`Pickers.kt:132` vs `EmojiPicker.tsx:335`). Step 1 fixes it, but a wrong
   fix breaks recents on every device at once. Round-trip test against a
   fixture the web wrote.
2. **Sprite sheet memory.** `g1.webp` alone is 1632 × 1088 ≈ 7 MB decoded. An
   LRU of three sheets is ~15 MB of bitmap on a device that may have 2 GB. This
   is the single most likely cause of an OOM in this work. Measure on a real
   low-end phone before shipping; the fallback (per-emoji SVG through Coil) is
   already there and can be left as the default on low-memory devices via
   `ActivityManager.isLowRamDevice`.
3. **APK size.** +2.2 MB for the base sheets, +4.2 MB for all fourteen. Not
   fatal next to three NDK ABIs, but it must be a decision, not an accident.
4. **`emoji.tsv` has no generator.** Nothing in `tools/` writes it, so the
   Android emoji set and the web's emojibase set can already drift, and the
   sprite `index.json` is keyed off the *web's* set. If a hexcode is in the
   sheets but not the tsv it is invisible; if it is in the tsv but not the
   sheets it silently falls back to an SVG. Write the generator, or at least a
   test that asserts every `emoji.tsv` row resolves to a sprite slot.
5. **`ModalBottomSheet` + IME.** Material 3's sheet animates its own height;
   combining that with `WindowInsets.ime` and `adjustResize` is the classic
   place Compose sheets jump or leave a gap. Test with the keyboard raised, on
   a gesture-nav device and a three-button device, and in landscape.
   `contentWindowInsets = { WindowInsets(0) }` plus one explicit bottom spacer
   is the arrangement least likely to fight the animation, but it needs eyes
   on a real phone.
6. **`HorizontalPager` inside a `ModalBottomSheet`, each page holding a lazy
   grid.** Nested scroll: a horizontal drag on the pager, a vertical drag on
   the grid, and a vertical drag on the *sheet* all compete. Getting the sheet
   to take a downward drag only when the grid is at its top is fiddly and is
   the most likely source of a "feels wrong" bug. Budget time for it, and
   consider `userScrollEnabled = false` on the pager (tabs only) as the
   fallback if it fights.
7. **Sticky header and rail disagreeing.** Two independently computed index
   maps will drift. One structure, computed once, read by both.
8. **GIF paging appending across a query change.** Guard with `mapLatest` and
   a `shownFor` marker; a stale page appended to a new search is the exact bug
   `GifPicker.tsx:58-88` is shaped to avoid.
9. **Animated emoji in a grid.** If the still-frame decoder is not wired
   correctly, a server with 200 animated emoji will play all visible ones and
   the grid will stutter. Verify with a pack of animated emoji, not a single
   one.
10. **No sticker settings page on Android.** The web's picker offers Edit,
    Remove and "create or install a pack". Three of those have nowhere to go on
    the phone. Do not ship dead links; say plainly where packs come from, and
    treat the settings page as separate work.
11. **New strings must land in the web catalogue first.**
    `web/src/i18n/locales/*.json`, because `CopyLocales`
    (`android/app/build.gradle.kts:36`) reads from there at build time. A
    string added only on the Android side will show as its key.
12. **This cannot be tested against the live instance.** Automated login is
    blocked by Turnstile; build against a local `chatd` with a seeded account,
    some custom emoji, an emoji pack, a sticker pack and a GIF key, and check
    the picker on an emulator — one emulator at a time, with a watchdog.
