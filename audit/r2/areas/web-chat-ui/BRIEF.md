# Brief — web-chat-ui (finding prefix `WCHAT`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

The message surface and everything a person touches while reading or
writing:

```
web/src/components/chat/        all 33 files (MessageList, MessageItem, ChatView, Attachments,
                                Embeds, VideoPlayer, AudioPlayer, Reactions, EditMessage,
                                PinsPanel, SubchatPanel, MemberList, GroupMemberList, TypingBar,
                                SelectionBar, StickerPopout, SystemMessage, LockedChannel, the
                                menus, fitMedia, mediaLinks, the CSS modules, the tests)
web/src/components/composer/    all 13 (Composer, Autocomplete, DropOverlay, commands, mentions,
                                linkPreviews, send, useAutosize)
web/src/components/pickers/     all 7 (EmojiPicker, ExpressionPicker, GifPicker, GifGrid,
                                StickerPicker, emojiIndex, Picker.module.css)
web/src/components/search/      all 6
web/src/components/profile/     all 5 (ProfileCard, ProfileModal, KeyVerify)
web/src/components/activity/    all 3
web/src/components/common/      all 40 (Avatar, Button, ContextMenu, FloatingPlane, IconPicker,
                                ImageCropModal, LoadError, Modal, QrCode, ScrollingText, Select,
                                Spinner, TextInput, Toasts, Toggle, Tooltip, Twemoji, ZoomPan,
                                animatedImage, Brand, the CSS)
web/src/markdown/render.tsx     (+ render.test.tsx)
web/src/styles/                 base.css tokens.css markdown.css fonts.css
web/src/pages/                  DMPage.tsx ServerPage.tsx ServerPage.module.css StickerPackPage.tsx
```

Out of scope: `shell/`, `sidebar/`, `rail/`, `modals/`, `settings/`,
`server/`, `friends/`, `desktop/` and the other pages (`web-shell-ui`);
`voice/` components (`voice`); stores, lib, api (`web-core` — but you read
them as needed to understand what a component does).

## What this area is

Discord-shaped chat: a virtual-ish message list with day dividers, grouped
consecutive messages, hover actions, a context menu, reactions with a `+`
row, replies with a quote bar, edits in place, pins panel, subchats (a
thread-like side panel), a member list, typing indicator, a composer with
markdown, `@`/`#`/`:` autocomplete, slash commands, drag-and-drop and paste
uploads, link previews the sender generates, a unified emoji/GIF/sticker
picker with skin tones and favourites, media viewers (image zoom/pan, video
with a custom player, audio player), embeds (links, YouTube, GIFs), profile
cards and the key verification (safety number + QR), and a client-side
search with Discord-style filters. Common components underpin every other
area (modal, context menu, tooltip, toasts, inputs, select, toggle).

Mobile (under 768 px, and touch) is a first-class target: the owner uses the
iPhone home-screen app daily. Eleven languages including Arabic (RTL). Light
and dark themes, and an accent colour a person can set to anything.

## Checklist

Reading messages:
- Grouping and dividers; timestamps (hover, absolute on tap on mobile?);
  edited markers; system messages; deleted-message placeholders; the
  unread divider ("new messages") and its persistence; jump-to-bottom;
  scroll anchoring on prepend, on images loading, on reactions changing,
  on the composer growing (round 1 fixed two — verify none remain by
  reading the effects); virtualisation (round 1: `@tanstack/react-virtual`
  is a dependency and unused — what does a 2,000-message channel cost?).
- Rendering (`render.tsx`): every node type; long words and URLs wrapping;
  code blocks (copy button? horizontal scroll? line wrapping on phones?);
  spoilers (revealed state persists? keyboard?); mentions (of you, of
  roles, of `@everyone`, of channels; colours; click behaviour); custom
  emoji size rules (jumbo when alone); links (external warning? `rel`?);
  timestamps in the app locale; tables? (Discord has none; is that fine.)
- Attachments and embeds: image sizing (`fitMedia`), aspect ratios, the
  spoiler overlay, alt text, download, open in viewer (`ZoomPan`: pinch on
  touch, wheel, double-tap, keyboard), video (`VideoPlayer`: controls on
  touch, fullscreen on iOS, PiP, poster, seeking encrypted streams, volume
  persistence), audio, generic files (name, size, icon, progress), failed
  decrypts, the media proxy expiry path (a preview older than a day reloads
  through `/proxy/refresh` — verify it does in the component).
- Reactions: add/remove, the `+`, who reacted (tooltip on hover; on touch?),
  custom emoji, counts updating, keyboard access.
- Context menu and hover actions: everything reachable on touch (long-press
  — `lib/longPress.ts`) and by keyboard (Shift+F10 / Menu key / a visible
  button); items that are permission-gated show correctly; copy text/link/id;
  reply, edit, pin, delete with confirmation, mark unread, select.
- Selection mode (`SelectionBar`): bulk delete, copy, on mobile.
- Pins, subchats, member list: loading, error (round 1: "a failed page of
  pins rendered like no pins" — check), empty states, permissions, mobile
  presentation (panel vs. sheet vs. page?).

Writing:
- Composer: Enter vs. Shift+Enter on desktop; on mobile Enter must be a
  newline and the send button visible; autosize max height; draft
  persistence per channel; paste of images/files/rich text; drag-and-drop
  overlay; attachment previews with remove and spoiler toggle; upload
  progress and failure and retry; the character limit and what happens at
  it; slowmode countdown; disabled states (no permission, locked channel,
  offline); edit mode (Up arrow to edit last message; Escape); reply state
  with "mention author" toggle; typing indicator sending (debounce; stops
  on send/clear/blur).
- Autocomplete: `@` (members, roles, `everyone`), `#`, `:` (emoji with
  skin tone, custom emoji), `/` commands; keyboard navigation; touch
  selection; RTL; popup placement near the bottom of a phone screen with
  the keyboard open (visual viewport handling — `noZoom.ts`, `useIsMobile`).
- Link previews generated by the sender: what is fetched when, can it be
  removed before send, does it leak the URL to the server before the
  message is sent (the unfurl route — say what the privacy story is).
- Pickers: search, categories, recents/favourites, skin tone, GIF search
  (Klipy), sticker packs, keyboard, touch, performance (sprite sheets —
  `9fcc57b`), the picker on a phone (full-screen? keyboard overlap?).

Cross-cutting UI quality (apply to every component in scope):
- **Touch targets** ≥ 44 px on mobile; hover-only reveals guarded by
  `@media (hover: hover)`; no `:hover` state stuck after a tap.
- **RTL**: logical properties (`margin-inline-start`, not `margin-left`),
  icons that should mirror (back arrows, send?) and ones that should not,
  text alignment of mixed-direction content (`dir="auto"` on message
  bodies), the composer caret, swipe directions.
- **Keyboard and screen reader**: focus order, focus visible, focus
  trapping in modals and menus, roles and names (`aria-label` on icon
  buttons — every one), live regions for new messages and toasts, Escape
  closing the top-most layer only, skip-to-composer.
- **Contrast** in both themes and with a user-chosen accent (round 1 made
  the accent compute its own foreground — verify it is used everywhere the
  accent is a background).
- **Reduced motion**: animations that remove information vs. motion.
- **Text**: truncation with `min-width: 0` on flex children, long names,
  long channel names, long usernames with emoji, CJK line breaking, the
  font stack (`Twemoji Text` first) and its cost.
- **Loading, empty, error** states for every async surface: never draw a
  failed request as an empty state; skeletons vs. spinners; retry
  affordance.
- **Safe areas** on iOS home-screen (`env(safe-area-inset-*)`), the visual
  viewport when the keyboard is open, `overscroll-behavior` on nested
  scrollers, `100dvh` vs `100vh`.
- **Consistency**: spacing scale, radii, shadows, icon sizes, button
  variants — are the common components used, or is there a hand-rolled
  copy somewhere? Any component in scope that reimplements what `common/`
  has is a `code` finding.
- **Design**: where the current design is clearly worse than what Discord
  (the stated reference) or a good mobile chat app does, propose the better
  thing concretely (`P3 · design`, or `P2` if it actively hurts).

Parity with Android (read-only, for comparison):
`android/.../ui/chat/ChatScreen.kt`, `MessageRow.kt`, `Composer.kt`,
`AttachmentViews.kt`, `MessageActions.kt`, `Players.kt`, `SwipeToReply.kt`,
`ui/markdown/Render.kt`, `ui/pickers/*`, `ui/sheets/ProfileSheet.kt`,
`KeyVerify.kt`. Where the phone does something better (swipe to reply,
say), that is a parity finding against the web; where the web does
something the phone lacks, against Android (`[android]` prefix).

## Round 1

`audit/REVIEW.md`, then the chat/composer/picker/common parts of
`audit/web-ui.md` (153 findings, 30 BROKEN — mostly RTL and contrast; 38 RTL
fixes were made) and `audit/web-bugs.md`'s component parts, and
`audit/product-gaps.md` for the parity matrix. Verify the RTL fixes hold and
the "13 surfaces that drew failure as empty" are fixed. Round 1 explicitly
skipped its 15 IDEA findings — read them; the good ones belong in this round
as `design` findings with your own judgement on each.

## Facts you would otherwise rediscover

- `img` is `display: block` in `base.css`, so inline emoji need
  `inline-block`.
- `window.prompt` is a no-op in Electron; every prompt goes through
  `PromptModal` (`web-shell-ui`'s file) — check nothing in scope still uses
  `prompt()`/`confirm()`/`alert()`.
- iOS turns the first tap on a hover-revealed control into a hover, so
  reveals must be guarded.
- The message list anchoring holds the first visible row's id and offset
  until the page settles (`22ae798`).
- Playwright is Chromium-only here; for layout checks at phone width use
  `tools/screenshot.py` against a throwaway server (the `ux-walkthrough`
  agent is doing a full screenshot pass — you may read
  `audit/r2/shots/` if it exists, but do not wait for it).

## Reading order

`styles/tokens.css`, `base.css`, `markdown.css` → `common/*` (they are used
by everything) → `chat/ChatView.tsx`, `MessageList.tsx`, `MessageItem.tsx`,
`Chat.module.css` → `markdown/render.tsx` → `chat/Attachments.tsx`,
`Embeds.tsx`, `VideoPlayer.tsx`, `AudioPlayer.tsx`, `fitMedia.ts`,
`mediaLinks.ts`, `StickerPopout.tsx` → `Reactions.tsx`, `EditMessage.tsx`,
`messageMenu.ts`, `SelectionBar.tsx`, `SystemMessage.tsx`, `TypingBar.tsx`
→ `PinsPanel.tsx`, `SubchatPanel.tsx`, `MemberList.tsx`,
`GroupMemberList.tsx`, `groupMemberMenu.ts`, `LockedChannel.tsx` →
`composer/*` → `pickers/*` → `search/*` → `profile/*`, `activity/*` →
`pages/DMPage.tsx`, `ServerPage.tsx`, `StickerPackPage.tsx` → the Android
files for parity → the tests.
