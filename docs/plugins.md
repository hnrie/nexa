# Plugins and custom CSS

Nexa can run plugins and custom CSS that people write themselves. Both are
added in Settings (Custom CSS, Plugins), both follow the account to every
device it signs in on, and neither is made or checked by Nexa.

## What a plugin can do

A plugin runs inside the app with the person's full access. It can read every
message the app can decrypt, send messages as them, and reach their keys.
The Plugins page and every dialog that adds one say this, and nothing is
added until the person ticks that they understand and trust its author.

Three things keep that honest:

- **Pinned code.** When a plugin is added, the SHA-256 of its exact code is
  saved with it. Only code with that hash is ever run for it. Pasted code is
  checked against the hash; code from a link is kept on each device by its
  hash, and when the link later serves anything else, the new code waits on
  the Plugins page under "Update available" until the person has looked at it
  and said yes. Nothing is updated silently.
- **Self-contained modules.** Plugins run from `blob:` module URLs made from
  the pinned code. The page's content security policy lets scripts come only
  from Nexa itself and those `blob:` URLs, and forbids `eval`, so a plugin
  cannot pull in more code from the network past its hash. Bundle everything
  into one file.
- **Safe mode.** Opening Nexa with `?safe` at the end of the address, or
  pressing "Start in safe mode" on the crash screen, starts it with custom CSS
  and plugins off for that tab. A plugin that throws while starting is turned
  off until the next reload, with a note saying so; one that took the page
  down while starting is skipped on the next start; and when the app crashes
  twice within ten minutes while plugins run, plugins start off.

## Writing one

A plugin is one JavaScript module whose default export describes it:

```js
export default {
  name: "Keyword alert",          // required
  description: "What it does, in a sentence.",
  version: "1.0.0",
  author: "You",
  settings: [/* optional, see below */],
  start(api) { /* required */ },
  stop() { /* optional */ },
};
```

`start` gets the API described below and may be `async` (it has 10 seconds).
Everything a plugin registers through the API (styles, listeners, commands)
is removed when it stops, so plugins can be turned off and on without a
reload. Keep the module's top level free of side effects: the module may be
loaded more than once. A full example is in
[`examples/keyword-alert.js`](examples/keyword-alert.js).

To install it, host the file somewhere that serves it over https and allows
other pages to fetch it (raw.githubusercontent.com and cdn.jsdelivr.net do),
then add the link on the Plugins page, or paste the code there. Pasted code is
kept in the account's encrypted settings, so it is limited to 64 KB each and
256 KB for all pasted plugins together; code from a link can be up to 1 MB.

## The API (version 1)

| Member | What it does |
| --- | --- |
| `api.apiVersion` | `1`. |
| `api.plugin` | `{ id, name, version }` of this plugin. |
| `api.app` | `{ name, build, locale }`: the app, its build id and the reader's language. |
| `api.me` | `{ id, username, displayName }` of the signed-in account. |
| `api.css.add(css)` | Adds a stylesheet; returns a function that removes it. |
| `api.css.clear()` | Removes every stylesheet this plugin added. |
| `api.toast(text, kind?)` | A short note at the bottom of the screen, under the plugin's name. `kind` is `"info"`, `"success"` or `"error"`. |
| `api.navigate(path)` | Goes to a page of the app, such as `/channels/@me`. |
| `api.events.on(event, handler)` | Listens for `messageCreate`, `messageUpdate` or `messageDelete`; returns a function that stops listening. |
| `api.commands.register({ name, description, run })` | Adds `/name` to the message box. `run(args, { channelId })` returns the message to send in its place, or nothing to send nothing. Returns a function that removes it. |
| `api.storage.get/set/remove/keys/clear` | JSON values kept on this device only, per account and plugin (up to 512 KB). |
| `api.settings.get(key)`, `.all()`, `.onChange(fn)` | The values the person chose for the plugin's declared settings. They follow the account. |
| `api.unsupported.stores` | The app's own state stores. Not part of the API: they change between releases without notice. |

A message, as `messageCreate` and `messageUpdate` hand it over, is decrypted
on the device:

```ts
{ id, channelId, serverId /* null in DMs */, authorId, content, decrypted,
  attachments: [{ name, type, size }], sticker: { id, name } | null,
  replyToId, mentions, createdAt, editedAt, mine }
```

`messageDelete` gives `{ id, channelId, message }`, where `message` is the
message as it was, when the device had it loaded.

## Settings

Declare settings and the Plugins page draws a form for them:

```js
settings: [
  { key: "word", type: "text", label: "Word to watch for", default: "release", placeholder: "…", maxLength: 100 },
  { key: "loud", type: "toggle", label: "Loud", description: "Says it twice", default: false },
  { key: "size", type: "number", label: "Size", min: 1, max: 5, step: 1, default: 3 },
  { key: "mode", type: "select", label: "Mode", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
  { key: "tint", type: "color", label: "Tint", default: "#8000ff" },
]
```

Keys are letters, digits, `.`, `-` and `_`. Values are checked against the
declared type before a plugin sees them.

## Custom CSS

The person's own CSS and the stylesheets they add from links are drawn after
all of the app's stylesheets, the person's own snippet last, so a rule as
specific as the app's wins. The easiest thing to change is colour: every
colour the theme builder's Advanced mode lists is a custom property, for
example `:root { --brand: #e91e63; }`. The theme in use is on
`<html data-look="…">` (such as `forest` or `custom-…`) for CSS that should
apply to one theme only.

Class names carry a hash that changes between versions, so match the stable
start of one: `[class*="_messageList_"]`. Rendered messages use plain class
names that do not change, such as `.md-mention`, `.md-codeblock` and
`.md-link`.

Stylesheets may `@import` other stylesheets and load fonts and images over
https. Each device keeps a copy of every stylesheet from a link, so the app
starts styled even when the site is down, and checks for a new version once a
day in the background (Refresh fetches it at once).
