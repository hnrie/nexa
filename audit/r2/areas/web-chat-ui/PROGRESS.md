# Progress — web-chat-ui
State: audit-done
Last checkpoint: 2026-09-19T11:31Z
Next finding id: 105

## Inspected

Styles (read first):
- [x] web/src/styles/tokens.css
- [x] web/src/styles/base.css
- [x] web/src/styles/markdown.css
- [x] web/src/styles/fonts.css

Common:
- [x] web/src/components/common/Avatar.tsx
- [x] web/src/components/common/Avatar.module.css
- [x] web/src/components/common/Brand.tsx
- [x] web/src/components/common/Button.tsx
- [x] web/src/components/common/Button.module.css
- [x] web/src/components/common/ContextMenu.tsx
- [x] web/src/components/common/ContextMenu.module.css
- [x] web/src/components/common/ContextMenu.test.tsx
- [x] web/src/components/common/FloatingPlane.tsx
- [x] web/src/components/common/FloatingPlane.module.css
- [x] web/src/components/common/IconPicker.tsx
- [x] web/src/components/common/IconPicker.module.css
- [x] web/src/components/common/ImageCropModal.tsx
- [x] web/src/components/common/ImageCrop.module.css
- [x] web/src/components/common/LoadError.tsx
- [x] web/src/components/common/LoadError.module.css
- [x] web/src/components/common/Modal.tsx
- [x] web/src/components/common/Modal.module.css
- [x] web/src/components/common/Modal.test.tsx
- [x] web/src/components/common/QrCode.tsx
- [x] web/src/components/common/QrCode.test.tsx
- [x] web/src/components/common/ScrollingText.tsx
- [x] web/src/components/common/ScrollingText.module.css
- [x] web/src/components/common/Select.tsx
- [x] web/src/components/common/Spinner.tsx
- [x] web/src/components/common/Spinner.module.css
- [x] web/src/components/common/TextInput.tsx
- [x] web/src/components/common/TextInput.module.css
- [x] web/src/components/common/TextInput.test.tsx
- [x] web/src/components/common/Toasts.tsx
- [x] web/src/components/common/Toasts.module.css
- [x] web/src/components/common/Toasts.test.tsx
- [x] web/src/components/common/Toggle.tsx
- [x] web/src/components/common/Toggle.module.css
- [x] web/src/components/common/Tooltip.tsx
- [x] web/src/components/common/Tooltip.module.css
- [x] web/src/components/common/Twemoji.tsx
- [x] web/src/components/common/ZoomPan.tsx
- [x] web/src/components/common/animatedImage.ts
- [x] web/src/components/common/animatedImage.test.ts

Chat:
- [x] web/src/components/chat/ChatView.tsx
- [x] web/src/components/chat/MessageList.tsx
- [x] web/src/components/chat/MessageList.test.tsx
- [x] web/src/components/chat/MessageItem.tsx
- [x] web/src/components/chat/Chat.module.css
- [x] web/src/components/chat/Attachments.tsx
- [x] web/src/components/chat/Embeds.tsx
- [x] web/src/components/chat/Embeds.module.css
- [x] web/src/components/chat/VideoPlayer.tsx
- [x] web/src/components/chat/VideoPlayer.module.css
- [x] web/src/components/chat/AudioPlayer.tsx
- [x] web/src/components/chat/AudioPlayer.module.css
- [x] web/src/components/chat/fitMedia.ts
- [x] web/src/components/chat/fitMedia.test.ts
- [x] web/src/components/chat/mediaLinks.ts
- [x] web/src/components/chat/mediaLinks.test.ts
- [x] web/src/components/chat/StickerPopout.tsx
- [x] web/src/components/chat/Sticker.module.css
- [x] web/src/components/chat/Reactions.tsx
- [x] web/src/components/chat/EditMessage.tsx
- [x] web/src/components/chat/messageMenu.ts
- [x] web/src/components/chat/messageMenu.test.ts
- [x] web/src/components/chat/SelectionBar.tsx
- [x] web/src/components/chat/SystemMessage.tsx
- [x] web/src/components/chat/TypingBar.tsx
- [x] web/src/components/chat/PinsPanel.tsx
- [x] web/src/components/chat/SubchatPanel.tsx
- [x] web/src/components/chat/MemberList.tsx
- [x] web/src/components/chat/MemberList.module.css
- [x] web/src/components/chat/GroupMemberList.tsx
- [x] web/src/components/chat/groupMemberMenu.ts
- [x] web/src/components/chat/groupMemberMenu.test.ts
- [x] web/src/components/chat/LockedChannel.tsx

Markdown:
- [x] web/src/markdown/render.tsx
- [x] web/src/markdown/render.test.tsx
- [x] web/src/markdown/parse.ts        (owned by web-core; read only for render findings)
- [x] web/src/markdown/ast.ts

Composer:
- [x] web/src/components/composer/Composer.tsx
- [x] web/src/components/composer/Composer.module.css
- [x] web/src/components/composer/Autocomplete.tsx
- [x] web/src/components/composer/DropOverlay.tsx
- [x] web/src/components/composer/DropOverlay.module.css
- [x] web/src/components/composer/commands.ts
- [x] web/src/components/composer/commands.test.ts
- [x] web/src/components/composer/mentions.ts
- [x] web/src/components/composer/mentions.test.ts
- [x] web/src/components/composer/linkPreviews.ts
- [x] web/src/components/composer/linkPreviews.test.ts
- [x] web/src/components/composer/send.ts
- [x] web/src/components/composer/useAutosize.ts

Pickers:
- [x] web/src/components/pickers/ExpressionPicker.tsx
- [x] web/src/components/pickers/EmojiPicker.tsx
- [x] web/src/components/pickers/emojiIndex.ts
- [x] web/src/components/pickers/GifPicker.tsx
- [x] web/src/components/pickers/GifGrid.tsx
- [x] web/src/components/pickers/StickerPicker.tsx
- [x] web/src/components/pickers/Picker.module.css

Search:
- [x] web/src/components/search/SearchPanel.tsx
- [x] web/src/components/search/SearchPanel.test.tsx
- [x] web/src/components/search/SearchSuggestions.tsx
- [x] web/src/components/search/SearchSuggestions.test.ts
- [x] web/src/components/search/useFullSearch.ts
- [x] web/src/components/search/Search.module.css

Profile and activity:
- [x] web/src/components/profile/ProfileCard.tsx
- [x] web/src/components/profile/ProfileModal.tsx
- [x] web/src/components/profile/Profile.module.css
- [x] web/src/components/profile/KeyVerify.tsx
- [x] web/src/components/profile/KeyVerify.module.css
- [x] web/src/components/activity/ActivityCard.tsx
- [x] web/src/components/activity/StatusLine.tsx
- [x] web/src/components/activity/Activity.module.css

Pages:
- [x] web/src/pages/DMPage.tsx
- [x] web/src/pages/ServerPage.tsx
- [x] web/src/pages/ServerPage.module.css
- [x] web/src/pages/StickerPackPage.tsx

Android parity (read-only, comparison):
- [x] android ui/chat/ChatScreen.kt
- [x] android ui/chat/MessageRow.kt
- [x] android ui/chat/Composer.kt
- [x] android ui/chat/AttachmentViews.kt
- [x] android ui/chat/MessageActions.kt
- [x] android ui/chat/Players.kt
- [x] android ui/chat/SwipeToReply.kt
- [x] android ui/markdown/Render.kt
- [x] android ui/pickers/*
- [x] android ui/sheets/ProfileSheet.kt
- [x] android KeyVerify.kt

Round 1 cross-check:
- [x] audit/REVIEW.md (Done / Not doing / Still open)
- [x] audit/web-ui.md chat/composer/picker/common parts + the 15 IDEA findings
- [x] audit/web-bugs.md component parts
- [x] audit/product-gaps.md parity matrix

## Handoff note
Done so far: styles, all of `common/`, all of `chat/` (bar its five test files),
`markdown/` (render.tsx + ast.ts + the parts of parse.ts the renderer depends on).
Findings WCHAT-001..059. Round-1 cross-check is done (see the list below).

Settled pending checks: font-scale still broken (018); lightbox z-index collides
with Toasts (022); `<t:>` formatters *do* use the app locale via `lib/time.ts`
(no finding); RenderNodes' content keys are deliberate and correct (no finding);
spoiler a11y is a finding (054); code-block copy is a finding (057).

Still pending:
- (c) SETTLED: ZoomPan has no key handling at all (no `onKeyDown`, no `tabIndex`);
  `zoomBy` always zooms about the centre, so keyboard zoom + no pan = only the
  middle of a picture is ever reachable → WCHAT-093.
- (d) Toasts `top: 16px` under the iOS status bar: `web/index.html:5` has
  `viewport-fit=cover` and no `apple-mobile-web-app-*` meta at all, so whether a
  toast lands under the status bar depends on web-shell-ui's shell insets. Left
  for web-shell-ui; do not write it here.
- (settled) the hand-rolled search boxes are now WCHAT-085; the conclusion is that
  `common/TextInput` is the wrong target (it is a bordered form field) and the
  missing thing is a `SearchBox`. SubchatPanel:170 is a name field, not a search box.
- English residue: 003/025/031/034/043/048/050 cover chat + common. If the
  composer, pickers, search, profile or activity turn up more, add one finding
  per surface rather than extending those.

Composer done → WCHAT-060..073. The two P1s are `useKeepFocused`
(`Composer.tsx:565`): it steals the caret into the wrong pane in a split (060) and
it eats Space on every focused button outside a dialog (061). Both want a browser
check if anyone has a session up. DropOverlay.module.css read with DropOverlay.

Pickers done → WCHAT-074..080. They are the best-built part of the area
(virtualised emoji grid, arrow keys, focus trap, real retry states); the findings
are search-in-English-only, the keyboard covering the phone sheet, and stickers/GIFs
losing the reply. GIF previews *are* proxied by the server (checked
internal/api/expression_handlers.go:958) — no third-party leak there.

Search done → WCHAT-081..085.

Profile + activity done → WCHAT-086..090. Checked and NOT findings: settings
(and therefore a profile note) are encrypted and the save is debounced 800 ms
(stores/settings.ts:295); activity images are proxied and non-https ones dropped by
the server (internal/gateway/activity.go:172, activity_test.go:119). KeyVerify.module.css
read with KeyVerify.tsx.

Pages done → WCHAT-091..092 (StickerPackPage is behind RequireAuth, so no anonymous-visitor finding).

Android parity pass done → WCHAT-094..102. What it produced:
- against the web: swipe-to-reply (095), the react permission not checked (096),
  24 px reaction pills on both (094).
- against Android (`[android]`): no `/`,`#`,`:` completions (097), no spoiler on a
  staged file + an 18 dp remove (098), sticker/GIF ignores the reply and slow mode
  — the phone's copy of 076 (099), pictures stretched to 320 dp and cropped (100),
  rich presence parsed and never drawn (102). 101 is the renderer's untranslated
  `@unknown-user`/`#deleted-channel`/`@unknown-role`, on both clients.
- Checked and NOT findings: Android's media goes through `MediaLinks`/`CoilSetup`,
  which re-signs stale `/media/proxy/` links and refuses any other host — the same
  rule as the web's `lib/mediaLinks.ts`, so no third-party leak on either. The
  Android picker is *better* than the web's on the two things 075 and 080 complain
  about (the sheet grows by the IME height and never autofocuses the search box;
  every control is 44-48 dp), and its GIF/sticker tabs are fully translated with
  real error/empty/retry states. Android honours the font-size setting (018 is
  web-only), formats "Joined on" in the app's language (087 is web-only), and its
  key-pinning chips/dialog match the web's, so 088 (no user-confirmed "verified")
  is cross-platform, as are 057 (the 90 % code block) and 059 (a relative
  timestamp that never ticks).

Tests done → WCHAT-103 (an unknown `/command` is published as text; found via
commands.test.ts covering only `/shrug`) and 104 (the unused
`@tanstack/react-virtual`, which the in-app licence page credits). The suites
themselves are good and need no findings: MessageList.test.tsx builds a fake
layout and pins both anchoring bugs round 1 fixed; messageMenu.test.ts covers the
permission matrix and batched deletes; render.test.tsx covers spoilers, links,
mentions, emoji, highlighting and `parseHighlightHtml`'s escaping;
SearchPanel.test.tsx drives the whole walk with a stubbed API.
Tests the fix phase must update with their findings: `render.test.tsx:51` pins the
masked-link `title` (055), `:70`/`:87` pin `@unknown-user`/`#deleted-channel` (101),
`linkPreviews.test.ts` pins fetch-as-you-type (062, 063), `commands.test.ts` wants
`/me` and the refusal (103).

AUDIT DONE. Every file ticked, 104 findings, Summary written at the top of
FINDINGS.md. Nothing is left pending.
