# Progress — web-chat-ui
State: auditing
Last checkpoint: 2026-09-18T20:26Z
Next finding id: 017

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
- [ ] web/src/components/chat/ChatView.tsx
- [ ] web/src/components/chat/MessageList.tsx
- [ ] web/src/components/chat/MessageList.test.tsx
- [ ] web/src/components/chat/MessageItem.tsx
- [ ] web/src/components/chat/Chat.module.css
- [ ] web/src/components/chat/Attachments.tsx
- [ ] web/src/components/chat/Embeds.tsx
- [ ] web/src/components/chat/Embeds.module.css
- [ ] web/src/components/chat/VideoPlayer.tsx
- [ ] web/src/components/chat/VideoPlayer.module.css
- [ ] web/src/components/chat/AudioPlayer.tsx
- [ ] web/src/components/chat/AudioPlayer.module.css
- [ ] web/src/components/chat/fitMedia.ts
- [ ] web/src/components/chat/fitMedia.test.ts
- [ ] web/src/components/chat/mediaLinks.ts
- [ ] web/src/components/chat/mediaLinks.test.ts
- [ ] web/src/components/chat/StickerPopout.tsx
- [ ] web/src/components/chat/Sticker.module.css
- [ ] web/src/components/chat/Reactions.tsx
- [ ] web/src/components/chat/EditMessage.tsx
- [ ] web/src/components/chat/messageMenu.ts
- [ ] web/src/components/chat/messageMenu.test.ts
- [ ] web/src/components/chat/SelectionBar.tsx
- [ ] web/src/components/chat/SystemMessage.tsx
- [ ] web/src/components/chat/TypingBar.tsx
- [ ] web/src/components/chat/PinsPanel.tsx
- [ ] web/src/components/chat/SubchatPanel.tsx
- [ ] web/src/components/chat/MemberList.tsx
- [ ] web/src/components/chat/MemberList.module.css
- [ ] web/src/components/chat/GroupMemberList.tsx
- [ ] web/src/components/chat/groupMemberMenu.ts
- [ ] web/src/components/chat/groupMemberMenu.test.ts
- [ ] web/src/components/chat/LockedChannel.tsx

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
Next: chat/ChatView.tsx, MessageList.tsx, MessageItem.tsx, Chat.module.css.