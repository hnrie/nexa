# Shared user text layout audit

The reported U+FDFD ligature is one code point with a very wide glyph. Character
counts do not bound rendered width, and wrapping cannot split one glyph or one
combining sequence. Repeating it exposed names that could determine a header's
minimum width and invite names that could grow to arbitrarily many lines.

The fix belongs at display boundaries. Unicode text is preserved in storage,
messages, copying and accessible text. No language or character blacklist is
introduced. Existing input and decrypted-payload limits remain in force.

## Display rules

- Identity fragments and compact labels fit one line, shrink inside flex rows,
  isolate their direction and clip excess ink. `PersonName` supplies this boundary
  throughout the web client. Android's `PlainName`, `Txt`, `PersonLine` and reduced
  motion `ScrollingText` bound their drawing. Styled names retain a bounded halo.
- Conversation, invite, pack, Discovery, shared-note and dialog titles show at
  most two lines. Rich embed and report subject headings allow three lines.
  Removable tags give the text its own shrinkable child, keeping controls visible.
- Descriptions, messages, notes, poll questions/answers and other substantive prose
  retain multiline content. Unbroken runs wrap; glyph ink stays in its content
  boundary. Existing Show More controls and local vertical scrollers remain.
- Code and tables can scroll horizontally inside their own wrappers. The message
  list itself cannot scroll sideways. Do not hide overflow on entire sidebar or
  overlay ancestors: that would cut off menus and focus affordances.
- Length limits are a separate defense. A short accepted value still needs a
  layout boundary. These changes also protect previously saved values and text
  arriving from bots, links, encrypted payloads and older clients.

The field-level [source ledger](UI_TEXT_INPUTS.md) includes the web and Android
input catalogs, dynamic prompts, format/CRDT editors, imports and explicit exclusions.

## Input to display inventory

The paths below identify the relevant entry points and shared renderers. A family
can have many consumers; protecting the common renderer covers lists, menus,
search results and translated sentences as well as the primary screen.

| Text supplied by people or integrations | Entry/state | Display consumers and boundary |
| --- | --- | --- |
| Display names, usernames, server nicknames | Profile/server profile editors, `api/users.ts`, user/member stores | `PersonName`, profile cards, message authors, friends/members, mention/autocomplete lists, moderation, voice participants, sharing, accounts and translated `personText` prose. Existing profile and row ellipses plus the shared identity boundary. |
| Pronouns and custom status | Profile/status editors, user/presence stores | Profile identity rows and bubbles, sidebar, account dock, header, `ScrollingText`. Existing clipping/marquee containers; normal prose wrapping also has an inherited fallback. |
| About Me and profile widget text/tags | Profile and widget editors, profile payloads | `ProfileCard`, `Widgets`, profile links and message profile cards. Markdown block bounds, existing About Me expansion, bounded widget headings and tags. |
| Server names, descriptions, categories and Discovery tags | Server settings, server store and Discovery API | Rail, server sidebar, pickers, search, invites, Discovery cards/details, server-tag popout and settings previews. Shared invite titles, bounded Discovery names/tags, existing row ellipses. |
| Channel/category/voice names and topics | Channel settings, channel/server stores | Chat headers, sidebar trees, search, pickers, voice lobbies, topic dialogs, channel mentions and conversation starts. Shrinkable header names, inline label bounds and wrapping markdown. |
| Group/subchat names | Create/edit group and subchat dialogs, channel store | DM sidebar, group header, conversation start, parent link, members and group invite cards/dialog/page. Names shrink independently of icons/buttons; starts and invites clamp titles. |
| Thread/post titles and forum tags/guidelines | Thread/post dialogs, channel/thread stores | Forum cards/filters, thread panel/chips, message event links, thread intro and parent header. Existing post clamps plus bounded tags, shared conversation title and system links. |
| Messages, replies, forwards, formatted fields and transcriptions | Composer/editor, decrypt/message stores | `Markdown`/`RenderNodes`, message content, replies, pins, search and previews. All prose block kinds wrap and clip ink, all mention kinds are width bounded; code/table scrolling stays local. Existing parser depth/source and payload limits remain. |
| Poll questions and answers | Poll composer, decrypted payloads and webhook messages | Webhook poll renderer and Android `Polls`. Text wraps inside bounded cards; answers and questions retain their content. |
| Attachment, upload and embedded file names | Upload/share, decrypted attachment metadata and notes | File cards, progress rows, media players, download/review sheets, search and `NoteFile`. Existing single-line name containers; inherited wrapping is a fallback for prose/error surfaces. |
| Sticker/emoji and pack names/descriptions | Pack editors/imports and expression APIs | Expression pickers, sticker details, public pack page, pack cards and server/moderation sheets. Invite typography reused by cards, bounded detail/page titles, existing tile/cover clipping. |
| Shared-note titles, content and collaborative identities | Notes editor, CRDT document and sharing state | Note list/header, reader/link card/page/history, markdown and cursor labels. Note reader/link titles clamp, remote cursor labels cap their width, bodies and identities use common boundaries. |
| Activity/game/music text and custom link labels | Rich Presence/integration payloads, profile activity/widgets | `ActivityCard`, `ScrollingText`, widget cards and action links. Existing marquee/row clipping, bounded widget titles/tags and wrapping body text. |
| App names, command descriptions, modal titles, labels/options | Developer portal, bot/webhook payload parsing, interactions | Consent pages, app cards, command lists, `AppForm`, `SelectBox`, shared field labels and dialogs. Bounded app/form titles, select options, field labels and tag controls. |
| Webhook sender, embed author/title/footer/fields and component labels | `webhookMessage.ts` / Android webhook decoder | `RichEmbeds`, webhook headers, components and media. Author labels shrink, linked and unlinked titles share the clamp, descriptions/values clip ink, existing component labels ellipsize. |
| Bug subjects/descriptions, case reasons, announcements and staff labels | Bug/report forms and moderation editors/APIs | Bug feed/list/detail, Nexa/case thread, moderation panels, announcement cards. Subject/announcement title bounds, shared identity/markdown/title rules and wrapping reasons. |
| Any of the above interpolated into transient UI | Translations, UI store, menu/popout APIs | Dialog titles, tooltips, context headings and toasts. Titles/headings clamp; tooltip words have a viewport-bounded box separate from the arrow; toast text clips within a bounded height. |

Android implements the same title limits at the corresponding call sites and
bounds text ink in common renderers. Its Compose constraints already keep ordinary
wrapping text inside its column. Conversation-start names now use an inline name
slot, so a group name cannot consume an unlimited number of explanatory lines.

## Additional sink review

The production web source contains no `dangerouslySetInnerHTML`, raw `innerHTML`
assignment or `srcDoc` sink for these fields. Markdown and highlighted code render
React nodes; the highlight bridge accepts its narrow span representation. Public
page metadata in `internal/api/static.go` uses `escapeAttr`. This is a focused
check of text rendering paths, not a claim that this layout audit replaces a full
security review of every feature.

## Regression checks

`web/tests/text-layout.html` is a Vite development-only fixture, not a production
build entry or application route. It renders actual `PersonName`, `InviteView`,
`ServerCard`, `Markdown` and `RichEmbeds` components alongside representative markup
using the actual chat, sidebar, forum, role, modal, note, profile and voice styles.
All eleven personal name effects are exercised. The fixture also exercises emoji
fallbacks, imported template labels, custom typing previews, profile statistics,
picker headings, integration controls and compact metadata. The fixture has a separate
TypeScript config checked with `cd web && npx tsc --noEmit -p tests`.

With a scratch chatd on 5274, run Vite with an explicit proxy target:

```sh
cd web
VITE_API_TARGET=http://127.0.0.1:5274 npm run dev -- --host 127.0.0.1 --port 5275 --strictPort
```

Then, from the repository root:

```sh
tools/.venv/bin/python tools/text_layout_audit.py http://127.0.0.1:5275 --out /tmp/nexa-text-shots
```

The runner checks 1366x768, 411x914 and 320x740, in both page directions, with ten
payloads: repeated U+FDFD, unbroken Latin, nonbreaking spaces, line/paragraph
separators, combining marks, directional overrides, joined emoji, CJK, HTML-like
text with markdown, and ordinary text. It asserts rendered fixture presence,
container/list width, title/identity line bounds, visible action positions and no
page errors or unexpected script dialogs. Code/table content deliberately exceeds
its wrapper width. An unclamped-invite negative control must fail the height check.
Screenshots and JSON results stay outside the repository.

`TextLayoutAuditActivity` is debug-only on Android. Launch it through adb with
`--es theme dark|light|forest`, `--es payload normal|wide|unbroken|combining|breaks|rtl`
and `--ei page 0|1|2`. It exercises common name, title, inline identity and markdown
renderers. Page 2 adds typing previews, checkbox labels and compact metadata.
These component fixtures supplement actual app-screen checks; they do
not replace navigating every future changed flow.
