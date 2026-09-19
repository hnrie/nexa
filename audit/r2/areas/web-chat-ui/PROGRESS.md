# Progress — web-chat-ui
State: auditing
Last checkpoint: 2026-09-19T05:46Z
Next finding id: 093

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
- [ ] web/src/components/chat/MessageList.test.tsx
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
- [ ] web/src/components/chat/fitMedia.test.ts
- [x] web/src/components/chat/mediaLinks.ts
- [ ] web/src/components/chat/mediaLinks.test.ts
- [x] web/src/components/chat/StickerPopout.tsx
- [x] web/src/components/chat/Sticker.module.css
- [x] web/src/components/chat/Reactions.tsx
- [x] web/src/components/chat/EditMessage.tsx
- [x] web/src/components/chat/messageMenu.ts
- [ ] web/src/components/chat/messageMenu.test.ts
- [x] web/src/components/chat/SelectionBar.tsx
- [x] web/src/components/chat/SystemMessage.tsx
- [x] web/src/components/chat/TypingBar.tsx
- [x] web/src/components/chat/PinsPanel.tsx
- [x] web/src/components/chat/SubchatPanel.tsx
- [x] web/src/components/chat/MemberList.tsx
- [x] web/src/components/chat/MemberList.module.css
- [x] web/src/components/chat/GroupMemberList.tsx
- [x] web/src/components/chat/groupMemberMenu.ts
- [ ] web/src/components/chat/groupMemberMenu.test.ts
- [x] web/src/components/chat/LockedChannel.tsx

Markdown:
- [x] web/src/markdown/render.tsx
- [ ] web/src/markdown/render.test.tsx
- [x] web/src/markdown/parse.ts        (owned by web-core; read only for render findings)
- [x] web/src/markdown/ast.ts

Composer:
- [x] web/src/components/composer/Composer.tsx
- [x] web/src/components/composer/Composer.module.css
- [x] web/src/components/composer/Autocomplete.tsx
- [x] web/src/components/composer/DropOverlay.tsx
- [x] web/src/components/composer/DropOverlay.module.css
- [x] web/src/components/composer/commands.ts
- [ ] web/src/components/composer/commands.test.ts
- [x] web/src/components/composer/mentions.ts
- [ ] web/src/components/composer/mentions.test.ts
- [x] web/src/components/composer/linkPreviews.ts
- [ ] web/src/components/composer/linkPreviews.test.ts
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
- [ ] web/src/components/search/SearchPanel.test.tsx
- [x] web/src/components/search/SearchSuggestions.tsx
- [ ] web/src/components/search/SearchSuggestions.test.ts
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
- [ ] android ui/chat/ChatScreen.kt
- [ ] android ui/chat/MessageRow.kt
- [ ] android ui/chat/Composer.kt
- [ ] android ui/chat/AttachmentViews.kt
- [ ] android ui/chat/MessageActions.kt
- [ ] android ui/chat/Players.kt
- [ ] android ui/chat/SwipeToReply.kt
- [ ] android ui/markdown/Render.kt
- [ ] android ui/pickers/*
- [ ] android ui/sheets/ProfileSheet.kt
- [ ] android KeyVerify.kt

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
- (c) ZoomPan keyboard: WCHAT-029/030 cover opening the viewer and the missing
  focus trap; panning by arrow keys is still unchecked (`common/ZoomPan.tsx` is
  ticked, so re-read only the key handling if a successor wants it).
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

Next: the Android parity files → profile/* → activity/* → pages/* →
the Android parity files → the six test files (MessageList.test.tsx,
fitMedia.test.ts, mediaLinks.test.ts, messageMenu.test.ts,
groupMemberMenu.test.ts, render.test.tsx) last.
