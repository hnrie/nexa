# Plugin API 2.0

Plan for building version 2 of the plugin API from the pre-release write-up, with the owner's
decisions of 2026-10-07 applied (two rounds). Nothing here is built yet. Approve, deny or change any part.

## Decisions already made

| Topic | Decision |
|---|---|
| Android | Plugins never run on Android. This is web and desktop only (the desktop app runs the web app). CLAUDE.md gets this as a standing exception to the "web and mobile" rule. |
| `servers.join(id)` | Removed from the API and the docs. |
| `typingStopped` | Simulated on the client (see Events). |
| Context menus | Every menu comes from one registry instead of being built inline. |
| Plugin keybinds | A separate list, apart from the app's own three (mute, deafen, activity), keyed by plugin id (not name). |
| Blocking `messageDeleted` | Left out of this release; it may come in a later update. Listeners' return values are ignored, and `events.write` covers only `events.run`. The docs drop the Blocking events section. |
| Commands | Throws when a plugin tries to take a built-in name. Between plugins it simply replaces: the replaced command is not brought back later. |
| Toasts | Gain `warning` and `duration`. |
| Size limits | Stay as they are: 64 KB per pasted plugin, 256 KB for all pasted plugins, 1 MB for a plugin from a link. The docs are corrected to say so. |
| Storage | Stays per device in `localStorage`, per account and plugin, 512 KB, and synchronous. The docs drop the `Promise`s and the "per account" wording. |
| Styles | `styles.add(stylesheet, persist?)`. By default (`persist` false) a stylesheet is removed when the plugin stops. With `persist: true` it stays after the plugin stops, until the function `add` returned is called, `styles.clear()` runs, the plugin is deleted or the page reloads. |
| Context menu registry | Every menu in the app moves into the registry, not only the four plugins can change. |
| Time limits | `start()` gets 10 seconds and `stop()` 3 seconds, in both v1 and v2 (as v1 today). |
| Toast `duration` | Clamped to 1 to 15 seconds. |
| v1 compatibility | `apiVersion: 1`, or no `apiVersion` at all (every plugin installed today), gets the whole v1 API unchanged. `apiVersion: 2` gets v2. The two live side by side. |
| What v2 drops | `navigate` and "a command returns the text to send" are gone in v2, by choice. |
| Channel and message types | All of them: channels `text`, `voice`, `category`, `dm`, `group_dm`, `subchat`, `announcement`, `forum`, `thread`, `private_thread`; messages `default`, `reply` and every `system_*` type. |
| `nonce` | Optional (`string \| null`). |
| `ThreadInfo.joined` | Defaults to `false`; the API fills it from the server's `joined_threads`. |
| Badges and role emoji | Passed through as the server sends them (`"icon:<name>"`, `"image:<id>"`, `"custom:<id>"`). The `Badge` object in the write-up becomes a plain `string`. |

## The pieces

### 1. Two API versions side by side (`web/src/lib/look/plugins/`)

- `api.ts` keeps the v1 types as they are. New `api2.ts` holds the v2 types from the write-up,
  with the decisions above applied.
- `runtime.ts` reads `apiVersion` after importing a plugin. `1` or missing builds today's
  `apiFor`; `2` builds a new `apiForV2` (in its own file, `runtimeV2.ts`, so `runtime.ts` stays
  readable). Any other value fails to start with a readable error.
- The `Running` record learns which version it is. On stop, v1 undoes what it does today. v2
  removes listeners, keybinds, commands, context menu changes and every stylesheet added without
  `persist`. Stylesheets added with `persist: true` are kept in a list of their own, outside the
  `Running` record, so they outlive the stop.
- Both versions keep today's limits: 10 seconds for `start()`, 3 seconds for `stop()`. Errors
  thrown in v2 callbacks are caught and logged (as v1 does already).

### 2. Permissions

- `PluginEntry` (`look/types.ts`) gets `permissions: string[] | null`: what the person granted.
  `null` means a v1 plugin with no permissions at all. `sanitize.ts` checks it against the known
  list (users, DMs, servers, app and `stores` permissions from the write-up).
- `AddPluginDialog` already imports the plugin to read its name. It also reads `apiVersion` and
  `permissions` and shows them:
  - v2: the list of permissions in plain words, with `stores` marked as dangerous, accepted
    before the plugin is added.
  - v1: a warning that the plugin is completely unrestricted and has full access to the account.
- `PluginUpdateDialog` asks again when the new code requests a permission that the old code
  didn't have. Pasted plugins get a new code editor ("Edit Code") that keeps the id, and goes
  through the same check.
- The Plugins page gets a way to see and change a plugin's granted permissions at any time.
  Taking one away applies at once, without a restart.
- `PermissionError` (exported, `name = "PermissionError"`) is thrown by any v2 method called
  without its permission. Events and context objects check permissions per delivery, so a
  permission taken away while running applies straight away.

### 3. The v2 managers

Each builds on what the app already does, so no new server routes are needed.

| Manager | Built on |
|---|---|
| `users` (`get`, `fetch`, `me`, `update`, `listRelationships`, and the relationship methods on `User`) | `stores/users`, `stores/relationships`, `GET /users/{id}`, `PATCH /users/@me`, `lib/friendship.ts` |
| `servers` (`get`, `fetch`, `list`, `create`, `update`, `leave`), `roles`, `members` | `stores/servers`, the server, role and member routes, `lib/perms` for `myPermissions` |
| `channels` (incl. `openDM`, `listDMs`, threads) | `stores/channels`, `stores/threads`, the channel and thread routes |
| `messages` | `stores/messages`, `lib/decrypt.ts`, and the same send, edit and delete code the message box uses, so encryption, keys, mentions and nonces are handled the usual way |
| `events` | `dispatchHooks` (see below) |
| `commands` | `components/composer/commands.ts` (see below) |
| `keybinds` | new plugin keybind list (see below) |
| `styles` | `look/styles.ts`, as v1's `css`; `add(stylesheet, persist = false)` |
| `storage` | v1's `localStorage` store, unchanged |
| `settings` | v1's settings, plus `set`, `reset` and per-key `onChange` |
| `ui` | `stores/ui` toasts, `lib/notify.ts`, the existing `confirm` modal, the context menu registry |
| `constants.Permissions` | `PERMS` from `lib/perms.ts` (the bits already match the write-up) |
| `stores` | the stores v1 hands out as `unsupported.stores`, behind the `stores` permission |

Objects handed to plugins are mapped from the wire types to the write-up's camelCase shapes in one
place (`pluginObjects.ts`): ids as strings, times as `Date`, permissions as `bigint`, image ids
turned into media URLs, and badge and emoji strings passed through as they are.

### 4. Events (`gateway/dispatch.ts`)

- New hooks next to the existing message ones: reactions, typing, members, servers, channels,
  users, presence, relationships and locale. Each fires after the store is updated, with the
  object as it is now.
- `messageDeleted` fires after the message leaves the store, with the message as it was. It cannot
  be blocked in this release.
- `typingStopped` is simulated: it fires when someone's typing entry in `stores/typing` runs out
  (the 10 second timer), or as soon as a message from them arrives in that channel.
- `events.run` fires `<plugin name>:<event>` to other plugins' listeners; it can never fire a
  built-in event.
- v1's `messageCreate`, `messageUpdate` and `messageDelete` keep working exactly as now.

### 5. Commands (`components/composer/commands.ts`)

- v2 `register(name, description, cb)`: a name that isn't lowercase or contains a space throws.
  A built-in name (`shrug`, `me`, `spoiler` and the rest) throws. A name another plugin holds is
  taken over, and stays gone for that plugin even after the new one stops.
- The callback gets `(args, { user, channel })` and nothing is sent in its place.
- v1 plugins keep v1's behaviour: their own `register({ name, run })` is refused on a clash and
  its returned text is sent.

### 6. Context menu registry

- New `web/src/lib/contextMenus/` with a registry. Every menu in the app moves into it (about 25
  today: message, image, member, group member, DM, DM group, server, channel, category, folder,
  thread, subchat, note, relationship, Nexa, activity, moderation, voice devices, text, and the
  smaller ones in pickers, settings and the staff panel). Plugins can change only `message`,
  `user`, `channel` and `server`. Each menu kind registers its built-in buttons once, each with a stable
  camelCase id (`deleteMessage`, `copyMessageLink`, `kickMember`, ...), a label key, an icon,
  `danger`, `separatorAfter`, a `visible(ctx)` and an `onClick(ctx)`.
- Components stop building item arrays inline. They open a menu by kind and context
  (`openMenu("message", { message, channel, server })`), and the registry builds the items,
  laying plugin changes over the built-ins.
- Today's builder functions (`buildMessageMenu`, `memberMenuItems`, `serverMenuItems`,
  `channelMenuItems`, `dmMenuItems` and the rest) become registry entries. Their tests move with
  them, and the menus must look and behave exactly as they do now.
- Plugins' `ui.contextMenu.add/remove/edit/get/list` work on this registry. Every change is
  recorded against the plugin and undone when it stops (a removed built-in comes back, an edited
  one returns to how it was).
- The docs list every built-in button id per menu, generated from the registry so the table can't
  fall out of date.

### 7. Plugin keybinds

- A separate list in the synced settings: `pluginKeybinds: { [pluginId]: { [keybindId]: string } }`,
  keyed by plugin id like storage and settings (the docs change "kept apart by plugin name" to
  "by plugin id"). A plugin that gets a new id starts with its keybinds unbound. Bindings use the
  same binding format `lib/keybinds.ts` already uses.
- Settings, Keybinds shows a section per running plugin, below the app's own keybinds, using the
  same recorder. New keybinds start unbound. Combinations the app reserves stay reserved.
- Keybinds work inside the app window only (the desktop app's system-wide shortcuts stay for mute
  and deafen).

### 8. Toasts (`stores/ui.ts`)

- `kind` gains `"warning"` (with its own colour and icon, through the design pass).
- `toast(text, kind, duration?)`: plugins can set the duration, clamped to 1 to 15 seconds. The app's own toasts keep their current timings.

## UI work

All of it goes through the `frontend-design` skill first: the permissions prompt, the v1 warning,
the permissions editor on the Plugins page, the Edit Code editor, the plugin keybinds section and
the warning toast. Every new string goes into all eleven locales.

## Documentation

- `docs/plugins.md` gets the v2 reference (the write-up, corrected by the decisions above), keeps
  v1 as its own section, and explains `apiVersion`.
- A v2 version of `docs/examples/keyword-alert.js`.
- A What's New entry for the new plugin API.
- CLAUDE.md: plugins are web and desktop only; menus come from the context menu registry; the
  new files under `lib/look/plugins` and `lib/contextMenus`.

## Testing

- Vitest: v1 still runs unchanged (existing `runtime.test.ts`); styles with and without
  `persist`; v2 permission checks, events
  (including the simulated `typingStopped`), command rules, the
  registry (add, remove, edit, undo on stop), keybinds, settings and storage.
- On a throwaway server with Playwright at 1366x768 and 411x914: installing a v1 and a v2
  plugin, the permissions prompt, changing permissions, the keybinds section, a plugin's
  context menu button, a hidden built-in button and its return after stop, the warning toast.
  Every existing context menu checked to look the same as before the registry.
- `tools/check.sh`, `python3 tools/i18n_check.py`, `python3 tools/i18n_keys_used.py`.
- No Android work, since plugins don't run there and the registry is web only.

## Order of work

1. Context menu registry, with every existing menu moved and unchanged (its own commit).
2. Dispatch hooks.
3. v2 runtime, permissions and managers.
4. Commands, keybinds, toasts.
5. UI (prompt, permissions editor, Edit Code, keybinds section) through the design pass.
6. Docs, example, What's New, CLAUDE.md. Then tests, screenshots, commit, push, and a throwaway
   server for you to try.
