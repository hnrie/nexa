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

## 2. Dispatch hooks (done, committed, not pushed)

What the v2 events will be built on: one hook per thing that can happen, fired by the gateway's
dispatch (`web/src/gateway/dispatch.ts`) after the stores have the change, with what was there before
when something goes. Step 2 only adds the hooks on the app's own wire types; turning them into the
plugin API's `messageCreated`, `memberJoined` and so on, with permissions, is step 3. Nothing
anyone sees changes, so there is no UI work, no What's New entry and no Android work.

Already there and kept as they are: `onMessage` (a message arrives, decrypted), `onMessageUpdate`,
`onMessageDelete` (after the message is gone, with the message as it was), `onMessageChange` (the
search index), `onFriendRequest`, `onReady`. Blocking a deletion is left out of this release.

- [x] One typed hook list, `dispatchHooks.onEvent`, taking an `AppEvent` (a union in
  `gateway/appEvents.ts`) instead of a separate list for every event:
  - [x] `reaction` (channel, message, user, emoji, added or removed), from `reaction_add` and `reaction_remove`
  - [x] `typing` (channel, user, started or stopped), see the typing item below
  - [x] `memberJoined`, `memberUpdated` (the member after the change), `memberLeft` (server, user,
    and the member as this device had it, read before `removeMember`), from `member_add`,
    `member_update`, `member_remove`
  - [x] `serverJoined` (the server once it is in the store), `serverLeft` (id, and the server as it
    was, read before it is removed): only when a server comes or goes, not for the servers `ready`
    brings, nor twice when the REST answer to joining or creating and the `server_create` event both
    arrive. Leaving, being kicked or banned and a server being deleted all count as leaving
  - [x] `channelCreated`, `channelUpdated`, `channelDeleted` (id, server, and the channel as it was),
    from the channel and thread events, DMs and groups included. A channel deleted with its threads
    is one event per channel
  - [x] `userUpdated` (the user after the change, from `user_update`, the signed-in account's own included)
  - [x] `presenceUpdated` (user and status), from `presence`
  - [x] `relationshipChanged` (the user, the new kind and the old one, `none` when there was or is
    no relationship), from `relationship_add` and `relationship_remove`
  - [x] `localeChanged` (the new language), fired by `i18n` once the new catalogue has loaded, through
    a small listener list there, since the language is switched in React and not by the gateway
- [x] A listener that throws is caught and logged and never stops the dispatch or the other
  listeners (today's hooks are called bare): every `dispatchHooks` call goes through `each`
- [x] Added while building: after a reconnect's `ready`, what changed while the connection was down
  (a server left or joined, a relationship, everyone typing having stopped) is told once the stores
  are filled again, since `ready` itself fills them quietly
- [x] Typing: a hook on the typing store (`stores/typing.ts`) rather than on the gateway, so every
  way typing ends is caught: `started` when someone starts showing as typing (not again for each
  refresh while they keep typing), `stopped` when they stop showing, whether the server said so
  (`typing` with `stop`), their message arrived (dispatch already takes them off then) or their 10
  seconds ran out in the sweep. Someone blocked never shows as typing, so never fires either
- [x] Tests (`gateway/dispatch.test.ts` and new ones beside the typing store and `i18n`): every
  event fires once with the right payload and after the store has the change; what was there is
  handed over when something goes; `ready` fires no `serverJoined`; a join seen twice fires once;
  typing starts once, stops on a stop, on a message and on expiry; a listener that throws leaves
  the rest working
- [x] Nothing changes for people: the existing web tests pass with no new failures (the same 110
  fail as before), and on the throwaway server Bob typing (the line under the chat, the dot pill,
  the dots after the channel name), his message arriving, Alice's reaction and Bob deleting it all
  work at 1366x768 and 411x914, with no page errors. Joining was not driven in the browser; the
  unit tests cover it
- [x] `tools/check.sh`: everything passes but web tests (the same 110 as before) and the three
  desktop steps (`desktop/node_modules` is not installed here). App size passes: 321.5 kB of the
  330 kB the front page now says; this step adds about 1.3 kB
- [x] CLAUDE.md: the hooks and `AppEvent` under the gateway section
- [x] Commit (not pushed: pushing waits until the owner says)

## 3. v2 runtime, permissions and managers (done, committed, not pushed)

The v2 API itself, behind `apiVersion: 2`, beside v1 which stays exactly as it is. Step 3 builds the
runtime, permissions as data and their checks, and every manager except `commands` and `keybinds`
(step 4). The install prompt, the v1 warning, the permissions editor and Edit Code are UI and come
in step 5; until then a v2 plugin is added through today's dialog. Web only (plugins never run on
Android); nothing people see changes until a v2 plugin is installed.

- [x] Decided by the owner: plugins can change every menu in the registry, not only four; and
  until step 5's prompt exists, a v2 plugin added through today's dialog is granted what it asks for
- [x] Types: `lib/look/plugins/api2.ts`, the write-up's types with the decisions in the plan
  (every channel and message type, optional `nonce`, `ThreadInfo.joined`, badges and role emoji as
  strings, storage synchronous, `styles.add(css, persist?)`, no `servers.join`, no event blocking)
- [x] Versions: `runtime.ts` reads `apiVersion` from the module (missing or 1: today's v1 API;
  2: v2; anything else fails to start, saying why). v2's API is built in a new `runtimeV2.ts`. The
  `Running` record says which version it is and keeps what v2 registers (listeners, styles split
  into removed-on-stop and persisted, context menu changes). Time limits stay 10 s for `start` and
  3 s for `stop` for both; errors thrown in v2 callbacks are caught and logged
- [x] Permissions as data:
  - [x] `PluginEntry.permissions: string[] | null` (`look/types.ts`): what the person granted; null
    for a v1 plugin. `sanitize.ts` keeps only the known permission names
  - [x] The known names in one list (`lib/look/plugins/permissions.ts`), with what each covers, for
    the checks here and the prompt in step 5
  - [x] Today's add dialog records what a v2 plugin asks for as granted (the prompt in front of it
    is step 5); a code update that asks for more keeps the old grants until step 5 asks
  - [x] `PermissionError` (exported, `name` "PermissionError"), thrown by any v2 method called
    without its permission. Every check reads the grants as they are now, so taking one away
    applies at once, to calls, events and the members of context objects (left `null`)
- [x] Turning the app's objects into the API's (`lib/look/plugins/objects.ts`), frozen, with ids as
  strings, times as `Date`, permissions as `bigint` and pictures as media URLs:
  - [x] `User`, `SelfUser`, `ServerTag`, `TypingStyle` (with `relationship` `null` without
    `users.relationships.read`, and `addFriend`, `removeFriend`, `block`, `unblock` checking
    `users.relationships.write` and refusing the signed-in account itself)
  - [x] `Server` (with `ServerTagSettings`, `ServerDiscovery`, `ServerVerification`, `roles`, `me`,
    `myPermissions`), `Role`, `ServerMember`
  - [x] `Channel` for every type (DMs with `serverId` null and `recipientIds`), `ChannelOverwrite`,
    `ForumSettings`, `ThreadInfo` (`joined` from the threads store, false when unknown)
  - [x] `Message` (`content` null when it could not be decrypted, `referencedMessage` one level
    deep from the message store or the reply targets), `Reaction`
  - [x] the relationship kinds' names: `incoming` becomes `incomingRequest` and `outgoing`
    `outgoingRequest`, `none` when there is none
- [x] Managers, each method checking its permission first and going through what the app already
  does, so keys, encryption, captchas, AutoMod and rate limits apply as they do in the app:
  - [x] `users`: `get` and `fetch` (`GET /users/{id}`), `me`, `update` (`PATCH /users/@me` with only
    the editable fields), `listRelationships(filter?)`
  - [x] `servers`: `get`, `fetch`, `list`, `create` (as Create Server does, its captcha included),
    `update`, `leave` (throws for the owner); `servers.roles` (`create`, `update`, `delete`, with
    `bigint` permissions); `servers.members` (`get`, `fetch`, `list` paging through every member,
    `update` with `nickname`, `roleIds` as the role changes it takes and `timeoutUntil`, `kick`,
    `ban` with a reason, `unban`, `mute` and `unmute` as a timeout); `servers.channels` is
    `api.channels`
  - [x] `channels`: `get`, `fetch`, `list`, `listDMs`, `openDM`, `create` (overwrites set after it
    is made), `update` (overwrites replaced, thread settings for threads), `delete`, `createThread`
    (`lib/threads.ts`'s `startThread`; a forum post's first message sent as the New Post dialog
    sends it, moved into a function both use), `joinThread`, `leaveThread`; `channels.messages` is
    `api.messages`
  - [x] `messages`: `get`, `fetch` and `list` (decrypted on this device as the app decrypts),
    `send` (the message box's `sendMessage`, changed to come back with the message it sent),
    `edit` (`editMessage`), `delete`, `react`, `unreact`; the permission by where the channel is
    (server channel or direct message); attachments neither read nor sent
  - [x] `events`: `on`, `once` and `run`. The v2 events built on step 2's hooks (`onMessage`,
    `onMessageUpdate`, `onMessageDelete`, `onEvent`), named as the write-up names them, each
    delivered only with the permission for what it carries, for server channels and DMs apart.
    `run` (needs `events.write`) fires `<plugin name>:<event>` to other plugins' listeners
  - [x] `styles`: `add(css, persist = false)` and `clear()`; persisted sheets kept outside the
    `Running` record, gone with `clear()`, the function `add` returned, deleting the plugin, or a reload
  - [x] `storage`: v1's per-device store, unchanged, behind `storage.read` and `storage.write`
  - [x] `settings`: `get` (the default until changed), `set` (checked against the declared type and
    range, throwing otherwise, and saved with the account as the Plugins page saves it), `getAll`,
    `reset(key?)`, `onChange(key, cb(value, old))`
  - [x] `ui`: `toast` (info, success and error for now; warning and duration are step 4; the toast,
    the notification and the confirm dialog's title say which plugin they come from), `notify`
    (through `lib/notify.ts`, which asks for the browser's permission and respects Do Not
    Disturb), `confirm` (the app's confirm dialog, resolving true or false), `contextMenu` (below)
  - [x] `constants.Permissions` (`PERMS` from `lib/perms.ts`), `app`, `plugin`, `apiVersion`
  - [x] `stores` (needs `stores`): the same stores v1 hands out as `unsupported.stores`
- [x] Context menus for plugins, in the registry (`lib/contextMenus/`). A button's `icon` is kept
  and reported, but the menus draw no icons yet; drawing them is design work for step 5:
  - [x] Every registered menu is open to plugins, named by its kind (`message`, `server`,
    `channel`, `member`, `dm`, `friend`, `callTile`, `textBox` and the rest, about 60), so the
    write-up's `menu` argument takes any of them. Each menu says how its context reads as the API's
    `ContextMenuContext`: `message`, `user`, `channel` and `server` where the menu is about one
    (a member's menu has `user` and `server`, a DM's `channel` and, for a one-to-one DM, `user`),
    `null` otherwise. The docs list every menu with what its context holds and its built-in
    button ids, generated from the registry so the lists cannot fall out of date
  - [x] Menus defined in screens that load later (pickers, notes, the staff panel): changed while
    building, instead of changes waiting for a menu to load, every menu module is listed in
    `lib/contextMenus/all.ts` and loaded before a v2 plugin with `ui.write` starts, so every menu
    and button is there from the start and `remove`, `edit`, `get` and `list` answer exactly
  - [x] A layer of changes over the built-in buttons: buttons added (placed `before` or `after` a
    button, or at the end), buttons removed, and buttons edited (`label`, `icon`, `danger`,
    `separatorAfter`, `visible`, and `onClick` with `original()`), each recorded against the plugin
    that made it, applied in the order they were made, and undone when it stops
  - [x] `add` throws when the id is taken, built-in or not; `remove` and `edit` throw for an id that
    is not there; `get` and `list` report what a menu shows, built-in or not
  - [x] A plugin's `visible` and `onClick` that throw leave the menu working (the button is left out,
    or the click does nothing)
- [x] Tests: the v1 suite unchanged and passing; v2 for the version switch, every permission check
  (a call, an event, a context object member), a permission taken away while running, each
  manager against a fake API, the object shapes, events per permission and per kind of channel,
  `events.run` between two plugins, styles with and without `persist`, settings `set` refusing bad
  values, the context menu layer (add, place, remove, edit, `original()`, undo on stop, two
  plugins changing one button)
- [x] A v2 test plugin on a throwaway server, pasted in through today's dialog, at 1366x768 and (as the
  account's plugins follow it) 411x914: it read the account, the server, a channel and the members;
  sent, edited, reacted to, listed and deleted a message; made and deleted a role and a channel;
  added a message menu button (whose click was told the message), renamed one and removed one;
  heard Bob's message; showed a toast; added a stylesheet; and its confirm was answered No. A v1
  plugin ran beside it. A notification was not tried, since headless Chromium cannot show one.
  The test plugins were removed from the account afterwards
- [x] `tools/check.sh`: everything passes but web tests (the same 110 as before) and the three
  desktop steps. App size passes: 324.5 kB of 330 kB; this step adds about 3 kB, mostly the menus'
  plugin layer, which loads with the app (the plugin runtime itself loads only for accounts with
  plugins)
- [x] CLAUDE.md: the v2 runtime, its files and the menus' plugin layer
- [x] Commit (not pushed: pushing waits until the owner says)

## 4. Commands, keybinds, toasts (not started)

## 5. UI through the design pass (not started)

## 6. Docs, example, What's New, CLAUDE.md, final testing (not started)
