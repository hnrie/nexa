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

## 2. Dispatch hooks (planned, not started)

What the v2 events will be built on: one hook per thing that can happen, fired by the gateway's
dispatch (`web/src/gateway/dispatch.ts`) after the stores have the change, with what was there before
when something goes. Step 2 only adds the hooks on the app's own wire types; turning them into the
plugin API's `messageCreated`, `memberJoined` and so on, with permissions, is step 3. Nothing
anyone sees changes, so there is no UI work, no What's New entry and no Android work.

Already there and kept as they are: `onMessage` (a message arrives, decrypted), `onMessageUpdate`,
`onMessageDelete` (after the message is gone, with the message as it was), `onMessageChange` (the
search index), `onFriendRequest`, `onReady`. Blocking a deletion is left out of this release.

- [ ] One typed hook list, `dispatchHooks.onEvent`, taking an `AppEvent` (a union in
  `gateway/appEvents.ts`) instead of a separate list for every event:
  - [ ] `reaction` (channel, message, user, emoji, added or removed), from `reaction_add` and `reaction_remove`
  - [ ] `typing` (channel, user, started or stopped), see the typing item below
  - [ ] `memberJoined`, `memberUpdated` (the member after the change), `memberLeft` (server, user,
    and the member as this device had it, read before `removeMember`), from `member_add`,
    `member_update`, `member_remove`
  - [ ] `serverJoined` (the server once it is in the store), `serverLeft` (id, and the server as it
    was, read before it is removed): only when a server comes or goes, not for the servers `ready`
    brings, nor twice when the REST answer to joining or creating and the `server_create` event both
    arrive. Leaving, being kicked or banned and a server being deleted all count as leaving
  - [ ] `channelCreated`, `channelUpdated`, `channelDeleted` (id, server, and the channel as it was),
    from the channel and thread events, DMs and groups included. A channel deleted with its threads
    is one event per channel
  - [ ] `userUpdated` (the user after the change, from `user_update`, the signed-in account's own included)
  - [ ] `presenceUpdated` (user and status), from `presence`
  - [ ] `relationshipChanged` (the user, the new kind and the old one, `none` when there was or is
    no relationship), from `relationship_add` and `relationship_remove`
  - [ ] `localeChanged` (the new language), fired by `i18n` once the new catalogue has loaded, through
    a small listener list there, since the language is switched in React and not by the gateway
- [ ] A listener that throws is caught and logged and never stops the dispatch or the other
  listeners (today's hooks are called bare)
- [ ] Typing: a hook on the typing store (`stores/typing.ts`) rather than on the gateway, so every
  way typing ends is caught: `started` when someone starts showing as typing (not again for each
  refresh while they keep typing), `stopped` when they stop showing, whether the server said so
  (`typing` with `stop`), their message arrived (dispatch already takes them off then) or their 10
  seconds ran out in the sweep. Someone blocked never shows as typing, so never fires either
- [ ] Tests (`gateway/dispatch.test.ts` and new ones beside the typing store and `i18n`): every
  event fires once with the right payload and after the store has the change; what was there is
  handed over when something goes; `ready` fires no `serverJoined`; a join seen twice fires once;
  typing starts once, stops on a stop, on a message and on expiry; a listener that throws leaves
  the rest working
- [ ] Nothing changes for people: the existing web tests pass with no new failures, and a quick
  look on a throwaway server that messages, deletions, reactions, typing and joining still look
  as they do on `main`
- [ ] `tools/check.sh`
- [ ] CLAUDE.md: the hooks and `AppEvent` under the gateway section
- [ ] Commit and push

## 3. v2 runtime, permissions and managers (not started)

## 4. Commands, keybinds, toasts (not started)

## 5. UI through the design pass (not started)

## 6. Docs, example, What's New, CLAUDE.md, final testing (not started)
