# Unfinished work: bot platform (and the rest of the owner's list)

Read this first if you are a new Claude session asked to "continue the bot work".
It holds the owner's request word for word, the rules that apply, what is done,
and how to finish the rest. Keep it up to date: when you finish a piece, move it
to "Done" and push, so the next session can take over at any moment.

## Rules that apply to every change

- Follow `CLAUDE.md` exactly (What's New entries for major features, UI text
  rules, all eleven translations, never `npm run build` / `make web` /
  `make server` / `make build` since building is deploying, migrations in both
  SQLite and Postgres folders with the same number, check UI at desktop and
  phone sizes).
- **Always deployable.** The owner hands this repo to another AI that copies it
  to another machine and deploys it. Every commit on the branch must build, pass
  `go vet ./...`, `go test ./...`, `npx tsc --noEmit -p .` and `npx vitest run`
  (in `web/`), `python3 tools/i18n_check.py` and `python3 tools/i18n_keys_used.py`,
  and work end to end. Never push half-wired code paths.
- **Unfinished code is marked and safe.** Anything not finished is marked with a
  `// Unfinished: <what is missing>` comment (Go and TypeScript; `<!-- Unfinished -->`
  in markup) and either hidden from users or answering with a clear error (for
  example HTTP 501 with a Discord-style JSON error) instead of behaving wrongly.
  Search for `Unfinished` to find every open end: `grep -rn "Unfinished" internal cmd web/src`.
- **Credits.** The owner pays per use and wants to stop before their credits
  run low (around $10 to $15 left). Ask them how much is left at the start, then
  check this session's spend after every feature or big change with the
  `get_session` tool (claude-code-remote MCP server, `session_id` omitted):
  `external_metadata.usage.cost_usd`. Report the figure. When the remainder
  nears $25, stop starting new work: finish what is open to a deployable state,
  mark the rest `Unfinished`, update this file, commit and push.
- Work on the branch the session is told to use, commit with clear messages,
  push with `git push -u origin <branch>`. Do not open a pull request unless
  asked.

## The owner's request, word for word

> i want a full bot api and bot system after you finish up all of what i said
> before and commit, you will use https://github.com/Rapptz/discord.py source
> code and your own research to replicate all features and bot api elements to
> work exactly with all the features in discord.py working perfectly with nexa
> the exact same way as discord. if these end up implementing new features
> unsupported by nexa or new items, you will implement those features. users
> should have access to any new features you implement also if users normally
> have access to them in actual discord!! you will research on everything you
> implement and test it on both mobile and desktop scenarios to make it perfect,
> no cutting corners. Read the discord api docs to replicate as much as possible
> in our own api system, we want it to be seamless for discord bot developers
> and for any project they have to easily be able to port over. Make docs too,
> just make sure we don't infringe on copyright. The docs can be in the settings
> or wherever you think is best i don't really care, even on the homepage at the
> top bar with "Developers" as a link and in the settings about section.

And, on keeping things safe to hand over:

> please make sure nothing is left in a undeployable point cause I will be
> giving this to another ai to copy this repo over and deploy it on my other
> machine when this is all done. Just makes sure it always stays deployable and
> functional yk? Marking stuff with // Unfinished and making a summary of the
> goal and how to complete the rest of it in a new session with a
> unfinishedbotwork.md file.

What that means in practice:

- A developer takes an existing **discord.py** bot, points it at Nexa (base URL
  and a Nexa bot token) and it works: logs in over the gateway, receives events
  (messages with content, members, reactions, interactions), and calls the REST
  API (send/edit/delete messages, embeds, files, reactions, members, roles,
  moderation, channels, application commands, interactions and components,
  threads, and so on), with Discord's shapes, status codes, error JSON and
  rate-limit headers.
- Anything bots can do that Nexa lacks gets built in Nexa, **for people too**
  where Discord gives people that feature (for example slash commands in the
  composer, buttons and select menus on messages, modals, threads).
- A Developers area: create an application and its bot, get and reset the
  token, choose intents, build an invite link (OAuth2 `bot` +
  `applications.commands` scopes with a permissions integer), add the bot to a
  server.
- Documentation written in Nexa's own words (no copying Discord's docs text),
  reachable from a "Developers" link in the home page's top bar and from
  Settings, About.
- Tested with a real discord.py bot, and the UI checked on desktop and phone.

## Status

### Done (on branch `claude/discord-webhook-embeds-evh2ml`)

- Incoming webhooks in Discord's format (`internal/api/webhook_*.go`,
  `web/src/components/chat/webhook/`, Server Settings, Integrations), with
  embeds, link buttons, layout components, polls with votes, files, GitHub and
  Slack formats. `tools/webhook_e2e.py` runs the whole flow. Webhook messages are
  the one kind the server can read, and the app says so on each.
- Unread fix (acks answered out of order, deleted newest message).
- Phone message box height fix (long placeholder).
- Friend request notes, sealed to the recipient (migration 0020).
- Add friends to group chats from the invite menu, "Let friends add me to group
  chats" privacy toggle with "Link Only" for friends, and the Nexa notice only
  the added person sees (migration 0021).
- Webhook 429s carry `Via`, which discord.py needs to wait instead of failing.

### Not started (the owner's list before the bot work)

- User polls: the composer's plus button offers "Upload a File" or "Create
  Poll"; polls use the webhook poll system (`internal/store/polls.go`,
  `internal/api/poll_handlers.go`, `web/src/components/chat/webhook/HookPoll.tsx`),
  gated by the existing Create Polls permission (`perms.CreatePolls`) that server
  owners can turn off. Keep the question and answers end-to-end encrypted in the
  message payload; the server only needs answer count, expiry and multiselect
  to take votes.

### Bot platform

Research done, nothing built yet. Read these before writing code:

- `docs/bots/design.md`: the full design (executive summary first), discord.py
  internals with file and function references, the gap table against Nexa, the
  encryption analysis and the phases.
- `docs/bots/discordpy-startup.md`: the exact requests, gateway opcodes and
  payload fields a server must answer for discord.py to reach `on_ready`, read
  a message and reply. Required fields are marked (a missing one crashes it).
- `docs/bots/mock-nexa.py`: a small aiohttp stand-in that answers that
  contract; unmodified discord.py 2.7.1 passed 19/19 checks against it.
- `tools/discordpy_test_bot.py`: the phase 1 acceptance test (PASS/FAIL lines),
  configured with `NEXA_API` (for example `http://127.0.0.1:PORT/api/v10`) and
  `NEXA_TOKEN`. Run it against a throwaway `chatd` (see `tools/e2e.py` for how
  to start one on a free port; never port 8090, never build into `web/dist`).

## Decisions

- **Encryption (owner: "do whatever is best"): design 1, server-held bot
  identity, with a fully encrypted mode later.** Each bot has an ordinary
  X25519 identity; the browser that creates the bot generates it and wraps the
  private key under a key derived from the bot token, plus an escrow copy sealed
  to the owner so a token reset keeps the identity. The server stores only the
  wrapped key, the public key and the token's SHA-256. Members' clients grant
  conversation keys to the bot like to any member (existing `keys_needed`
  flow); the installing admin's client grants at install. A bot gets keys in a
  server only with Read Messages access, which needs the app's Message Content
  toggle and the installer's consent; without it the bot sees no content and
  its own posts are stored like webhook messages (readable, marked). While a
  reading bot runs, the Nexa server can read the channels it sees: say so on the
  install screen, in the channel header, in the privacy policy (`docs/legal`)
  and in the README. Later: "Encrypted Apps", a sidecar the developer runs that
  holds the key on their machine, same wire format (phase 6).
- Developer docs may name discord.py and describe the API as Discord-compatible
  (that is what the feature is), in Nexa's own words; never copy Discord's docs.
- Apps are private by default with a "Public Bot" switch, as developers expect.

## Plan for the bot platform (from docs/bots/design.md)

Pointing discord.py at Nexa takes three assignments, shipped as a snippet in
the docs: `discord.http.Route.BASE = "https://HOST/api/v10"`,
`DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("wss://HOST/gateway/bot")`,
`discord.utils.DISCORD_EPOCH = 1767225600000` (Nexa ids count from 2026).
discord.py never calls `GET /gateway`. JSON answers must be exactly
`Content-Type: application/json`; 429s need `Via`, `retry_after`, `global`.
The bot gateway is a second protocol at `/gateway/bot` (HELLO first, heartbeat
before IDENTIFY, per-session sequence numbers, READY with `session_id` and
`resume_gateway_url`); Nexa's own `/gateway` stays as it is.

- **P0 groundwork:** shared Discord-format errors and object serializers for
  users, members, roles, channels and messages; docs skeleton at `/developers`.
- **P1 log in, read, reply (largest):** applications, bot users, tokens
  (`Authorization: Bot <token>`), `/api/v10` routes discord.py calls at start,
  the `/gateway/bot` dialect with intents, GUILD_CREATE with the bot's member,
  MESSAGE_CREATE/UPDATE/DELETE with content, sending/editing/deleting messages,
  server-side bot crypto, the Developers area (create app, bot, token reset,
  intents, invite link builder), the OAuth2 install page (scopes `bot` and
  `applications.commands`, permissions integer), app tags and the encryption
  notices. Exit test: `tools/discordpy_test_bot.py` passes against a throwaway
  server, and the UI is checked at desktop and phone sizes.
- **P2 interactions:** application commands (global and guild, bulk overwrite
  sync), INTERACTION_CREATE, callback types, followups via webhook-token routes,
  ephemeral replies, buttons, select menus, modals, autocomplete, and for
  people: the slash command picker in the composer, clickable components.
- **P3:** members and REQUEST_GUILD_MEMBERS chunking, roles, channels,
  moderation (kick, ban, timeout), audit log, reactions, pins, typing, presence,
  session RESUME, full rate-limit headers.
- **P4:** threads and forum channels, for people too.
- **P5:** polls through the bot API (user polls above first), stickers, polish.
- **P6:** Encrypted Apps sidecar, sharding, HTTP interactions endpoint.

Not feasible: bot voice audio (Nexa calls are WebRTC with frame encryption and
the tunnel carries only HTTP); voice states and voice moderation are fine (P3).
Planned-but-unbuilt routes answer 501 with a Discord-style error and an
`// Unfinished:` marker. New migrations take the next free number (0022 on).
