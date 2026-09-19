# Progress — web-chat-ui
State: auditing
Last checkpoint: 2026-09-19T00:35Z
Next finding id: 054

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
- [ ] web/src/markdown/render.tsx
- [ ] web/src/markdown/render.test.tsx
- [ ] web/src/markdown/parse.ts        (owned by web-core; read only for render findings)
- [ ] web/src/markdown/ast.ts

Composer:
- [ ] web/src/components/composer/Composer.tsx
- [ ] web/src/components/composer/Composer.module.css
- [ ] web/src/components/composer/Autocomplete.tsx
- [ ] web/src/components/composer/DropOverlay.tsx
- [ ] web/src/components/composer/DropOverlay.module.css
- [ ] web/src/components/composer/commands.ts
- [ ] web/src/components/composer/commands.test.ts
- [ ] web/src/components/composer/mentions.ts
- [ ] web/src/components/composer/mentions.test.ts
- [ ] web/src/components/composer/linkPreviews.ts
- [ ] web/src/components/composer/linkPreviews.test.ts
- [ ] web/src/components/composer/send.ts
- [ ] web/src/components/composer/useAutosize.ts

Pickers:
- [ ] web/src/components/pickers/ExpressionPicker.tsx
- [ ] web/src/components/pickers/EmojiPicker.tsx
- [ ] web/src/components/pickers/emojiIndex.ts
- [ ] web/src/components/pickers/GifPicker.tsx
- [ ] web/src/components/pickers/GifGrid.tsx
- [ ] web/src/components/pickers/StickerPicker.tsx
- [ ] web/src/components/pickers/Picker.module.css

Search:
- [ ] web/src/components/search/SearchPanel.tsx
- [ ] web/src/components/search/SearchPanel.test.tsx
- [ ] web/src/components/search/SearchSuggestions.tsx
- [ ] web/src/components/search/SearchSuggestions.test.ts
- [ ] web/src/components/search/useFullSearch.ts
- [ ] web/src/components/search/Search.module.css

Profile and activity:
- [ ] web/src/components/profile/ProfileCard.tsx
- [ ] web/src/components/profile/ProfileModal.tsx
- [ ] web/src/components/profile/Profile.module.css
- [ ] web/src/components/profile/KeyVerify.tsx
- [ ] web/src/components/profile/KeyVerify.module.css
- [ ] web/src/components/activity/ActivityCard.tsx
- [ ] web/src/components/activity/StatusLine.tsx
- [ ] web/src/components/activity/Activity.module.css

Pages:
- [ ] web/src/pages/DMPage.tsx
- [ ] web/src/pages/ServerPage.tsx
- [ ] web/src/pages/ServerPage.module.css
- [ ] web/src/pages/StickerPackPage.tsx

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
Styles and common/ done (16 findings, WCHAT-001..016). Round-1 cross-check done: RTL avatar cut (001), context-menu #fff (002), hardcoded English (003), toast lifetime (015), cropper keyboard (007), FloatingPlane touch (008) are round-1 items still open; Modal trap/labels, ContextMenu keyboard, Toasts live region, Tooltip describedby/Escape, Field aria, ImageCrop errors are confirmed fixed.
Pending checks to make when reaching the files: (a) Chat.module.css — does the font-scale slider move chat text now (round 1 BROKEN); is the lightbox z-index 200 = Toasts 200 (toast hidden behind lightbox?); (b) render.tsx — spoiler a11y (text node only `color: transparent`), `<t:>` formatters via lib/time, RenderNodes index keys, code-block copy button; (c) Attachments lightbox keyboard for ZoomPan; (d) Toasts `top: 16px` and index.html `viewport-fit=cover` with no shell top inset — write as finding once the apple status-bar meta is known.
Predecessor's pending checks now resolved: font-scale is still broken (WCHAT-018),
lightbox z-index 200 does collide with Toasts 200 (WCHAT-022). Still pending:
(b) render.tsx spoiler a11y / `<t:>` formatters / RenderNodes keys / code-block copy;
(c) Attachments lightbox keyboard for ZoomPan; (d) Toasts `top: 16px` vs the iOS
status bar — `index.html:5` has `viewport-fit=cover` and no `apple-mobile-web-app-*`
meta at all, so check with web-shell-ui before writing it.
ChatView/MessageList/MessageItem/Chat.module.css done → WCHAT-017..027. The two
biggest: no keyboard route to any message action (017) and the font-size setting
being a no-op (018).
Hardcoded English: now written up (003/025/031/034/043/048/050 cover everything
found so far; add to a new finding if the composer/pickers/search turn up more).
Old list, kept for reference:
VideoPlayer.tsx:294 `SPOILER`, AudioPlayer.tsx:134 `Pause/Play ${name}`, :175-176
`Unmute/Mute` (in 003), :180 `Download ${name}`, Embeds.tsx handled by 034,
StickerPopout handled by 046, Attachments handled by 031, SystemMessage.tsx:14
`"someone"` fallback. Also for that finding: messageMenu.ts:84-85 uses the literal
`4` instead of MSG_FLAG_SUPPRESS_EMBEDS (server masks the field, so no bug).
Pending: one P3 `code` finding for the six hand-rolled `<input>` search boxes
(ChatView:238, SubchatPanel:170, EmojiPicker:464, GifPicker:154, StickerPicker:53,
SearchPanel:119, SearchSuggestions:80) instead of common/TextInput — write it once
Picker.module.css and Search.module.css are read, so the differences are concrete.
Next: MemberList, GroupMemberList, groupMemberMenu → markdown/render.tsx →
composer → pickers → search → profile → activity → pages → Android parity → tests.
MessageList.test.tsx left with the other tests at the end.