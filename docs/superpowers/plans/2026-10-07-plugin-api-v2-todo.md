# Plugin API 2.0: progress

Progress on [the plan](2026-10-07-plugin-api-v2.md). Ticked items are done. For now only step 1, the
context menu registry, is being built.

## 1. Context menu registry (done)

- [x] Survey every menu the app opens and where it is built (64 places in 37 files)
- [x] Registry module (`web/src/lib/contextMenus/registry.ts`): menu kinds, buttons with stable ids, groups with lines between them
- [x] Registry tests, plus a guard test that fails while any file outside the registry opens a menu itself
- [x] Move the menus into the registry (60 menus in all; the voice moderation menus that arrived from the other machine meanwhile too):
  - [x] Message (`chat/messageMenu.ts`, `MessageItem`), image (`Lightbox`), system message (`SystemMessage`)
  - [x] Server, channel, category (`sidebar/serverMenu.ts`, `ServerSidebar`)
  - [x] Rail: server, folder, bulk, Nexa, moderation, DM (`rail/*`, `Rail`)
  - [x] DM sidebar: DM, group, subchat, DM group, bulk, open (`sidebar/dm*.ts`, `openMenu.ts`, `DMSidebar`, `SubchatPanel`)
  - [x] Members: server member, member bulk, group member, group member bulk (`MemberList`, `GroupMemberList`, `memberMenu.ts`, `memberBulk.ts`, `groupMemberMenu.ts`)
  - [x] Friends: relationship, friends bulk (`lib/friendship.ts`, `friendsBulk.ts`, `FriendsPage`)
  - [x] Profile card (roles to add, more)
  - [x] Chat header and thread bar (`ChatView`, `ThreadBar`), forum (`ForumView`), search results
  - [x] Composer (more, plus)
  - [x] Voice: participants, call view, camera, microphone, noise, devices, activity (`voice/*`, `UserPanel`, `ActivityToggle`)
  - [x] Video player
  - [x] Notes: list, note, sharing (`noteMenu.ts`, `NotesList`, `NoteView`, `ShareNoteModal`)
  - [x] Pickers: GIFs, stickers; `common/Pick`
  - [x] Server settings: roles, invites, members (Mod View), sticker packs
  - [x] Settings: typing style, server profile
  - [x] Nexa and staff: case and bug threads (`ThreadChat`), bugs tab, user grid
  - [x] Text menu (`lib/textMenu.ts`)
- [x] No inline menus left: every `openContextMenu` call opens a registered menu (the guard test passes), and a test loads every menu module together to catch clashing button ids
- [x] Existing tests pass (`npx vitest run`, `npm run typecheck`): no new failures. Before this work 111 tests already failed on this machine (most need `localStorage`, which this Node version's test environment lacks); the goal is no new failures
- [x] Menus look and behave as before: GitHub's `main` (with the voice moderation from the other machine) and this change built side by side on two throwaway servers with the same seed, and 31 menus opened in both at 1366x768 and 411x914: message, link, text box, member, server header, channel, voice channel, category, rail server, DM row, DM list, friend row, profile More, and in a call someone's row under the voice channel, your own row, someone's tile and the microphone menu (with Alice owning the server, so every moderator item shows); on a phone also the header's More, the + button and the tools button. Every one lists the same items, lines, ticks and disabled items in both, and the screenshots match. Not driven in a browser: the notes, picker, forum, search, Mod View and staff panel menus (covered by the typecheck and their unit tests only)
- [x] `tools/check.sh`: Go build, vet and tests, web typecheck, web build and i18n keys pass. Failing, as they did before this change: web tests (the same 110 as before), app size (the first load was already 319.6 kB against the 300 kB the front page promises; this change adds 0.6 kB), and the three desktop steps (`desktop/node_modules` is not installed on this machine)
- [x] CLAUDE.md: menus come from the registry
- [x] Commit and push

## 2. Dispatch hooks and the delete hook order (not started)

## 3. v2 runtime, permissions and managers (not started)

## 4. Commands, keybinds, toasts (not started)

## 5. UI through the design pass (not started)

## 6. Docs, example, What's New, CLAUDE.md, final testing (not started)
