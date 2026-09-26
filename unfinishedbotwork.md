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

### In progress / not started (the owner's list before the bot work)

- Add friends to group chats from the group's invite menu, a "Let friends add
  me to group chats" privacy toggle with "Link Only" shown to friends, and a
  notice from the Nexa account, visible only to the added person, saying who
  added them and where to turn it off (migration 0021).
- User polls: the composer's plus button offers "Upload a File" or "Create
  Poll"; polls use the webhook poll system (`internal/store/polls.go`,
  `internal/api/poll_handlers.go`, `web/src/components/chat/webhook/HookPoll.tsx`),
  gated by the existing Create Polls permission (`perms.CreatePolls`) that server
  owners can turn off. Keep the question and answers end-to-end encrypted in the
  message payload; the server only needs answer count, expiry and multiselect
  to take votes.

### Bot platform

Not started beyond research. See "Plan" below; the research notes are in
`docs/bots/` once committed.

## Plan for the bot platform

To be filled in from the research (discord.py startup sequence, gateway and
REST requirements, the end-to-end encryption decision, phases). Until then,
the phases are expected to be:

1. Applications, bot users and tokens; `Authorization: Bot <token>`;
   `/api/v10` routes discord.py needs to start (`/users/@me`, `/gateway/bot`,
   `/oauth2/applications/@me`); a Discord-compatible gateway (HELLO, IDENTIFY,
   READY, GUILD_CREATE, heartbeats, RESUME) with intents; MESSAGE_CREATE with
   content; sending messages. A test bot in `tools/` that must pass.
2. Adding bots to servers (OAuth2 authorize page), the Developers area in the
   app, bot tags in the UI.
3. Application commands and interactions (slash commands, buttons, select
   menus, modals, autocomplete, ephemeral replies), including the user side in
   the composer and on messages.
4. Members, roles, moderation, channels, reactions, pins, typing, invites,
   audit log, emojis and stickers through the bot API.
5. Threads and anything else discord.py covers that Nexa lacks, for people too.
6. Developer documentation pages.
