# Encryption review

## Summary

The scheme is well built at the primitive level and, unusually for a three-platform
re-implementation, the three platforms genuinely agree. I verified that agreement
rather than assuming it: the Android test vectors in
`android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt:39-47` reproduce exactly
from the web client's own primitives when I ran them, the hand-written AES-256-GCM
in `android/app/src/main/cpp/aes_gcm.cc` passes all six NIST AES-256-GCM vectors
including the 8-byte and 60-byte IV cases, and a sealed call frame produced by the
C++ `SealFrame` is byte-for-byte identical to one produced by the web client's
`sealFrame` for the same key, IV and input. Nonce handling for messages, settings,
files and call frames is correct — the file chunk counter cannot wrap or repeat,
and the frame counter re-salts before it overflows. Argon2id parameters are above
current OWASP guidance, HKDF info separation is real, every source of randomness
that touches key material is a CSPRNG on all three platforms, and the server code
never decrypts anything.

The problem is not the cryptography. It is the trust model around it. **Every
public key a client encrypts to is supplied by the server, and no client ever
verifies one.** There is no fingerprint, no safety number, no key-change warning —
I searched all three platforms for one and found nothing. Worse, the server does not
even have to substitute a key and wait: a single fabricated `keys_needed` gateway
event makes an online member's client wrap the conversation root key for an
attacker-chosen user id and upload it, silently, with no UI at all
(`web/src/gateway/dispatch.ts:265`, `web/src/stores/keys.ts:151-155`). The product's
claim is that the server never sees plaintext; as built, the server can help itself
to any conversation key it wants, at any time, without the ciphertext ever changing
shape. Everything else in this report is secondary to that.

Second in line: both clients accept the argon2id salt **and cost parameters** from
the server at login with no floor (`web/src/stores/auth.ts:175-176`,
`android/.../data/Session.kt:147-150`), so a server can weaken password stretching
to near nothing for one login and recover the plaintext password from the auth key
it is handed. Third: key rotation does not actually cut off a removed member,
because the server accepts writes under any epoch up to the latest and clients
encrypt under the newest epoch *they* hold, not the newest that exists.

Counts: 1 CRITICAL, 2 HIGH, 8 MEDIUM, 7 LOW, 6 HARDENING.

## What the server can see (the honest list)

Opaque to the server (verified): message bodies, attachment bytes, attachment
filenames, MIME types, dimensions, durations and per-file keys, sticker/embed
content inside a message, the user-settings document, conversation root keys, the
identity private key, the password, the recovery key.

Plaintext to the server:

- **Who talks to whom, when, and how much.** Every message row carries
  `channel_id`, `author_id`, `created_at`, `edited_at`, `type`
  (`internal/db/migrations/0001_init.sql:162-179`). Timing and volume are fully
  exposed.
- **The mention graph.** `mentions`, `mention_roles`, `mention_everyone` are
  plaintext JSON columns (`0001_init.sql:171-173`), extracted client-side from the
  decrypted text and handed over so the server can route notifications. The server
  learns exactly who each message names.
- **The reply graph.** `reply_to_id` (`0001_init.sql:170`), validated server-side
  (`internal/api/message_handlers.go:272-280`).
- **Every reaction.** `reactions.emoji` is a plaintext column keyed by message and
  user (`0001_init.sql:196-202`) — who reacted with what, on which message.
- **Whether a message has attachments, and their exact ciphertext sizes.**
  `has_attachments` (`0001_init.sql:174`), `attachments.size`
  (`0001_init.sql:190`), `blobs.size` (`0001_init.sql:7`). AES-GCM plus the chunked
  container is length-preserving to within a few bytes per 4 MiB chunk, so the
  plaintext file size is effectively known.
- **Message flags** (pinned, suppress-embeds) and the client's idempotency `nonce`
  (`0001_init.sql:175-176`).
- **Channel names and topics, server names and descriptions** —
  `channels.name`/`channels.topic` (`0001_init.sql:128-129`),
  `servers.name`/`servers.description` (`0001_init.sql:77,81`).
- **User profiles**: `display_name`, `about_me`, `pronouns`, `status_text`,
  `status_emoji`, accent colours (`0001_init.sql:24,34-38`), server nicknames
  (`server_members.nickname`, `0001_init.sql:92`) and even the private nickname you
  give a friend (`relationships.nickname`, `0001_init.sql:69`).
- **Role names** (`0001_init.sql:104`), **ban reasons** (`0001_init.sql:235`), and
  an **audit log** whose `changes`/`reason` columns carry channel names, topics and
  nicknames (`0001_init.sql:248-249`, written at
  `internal/api/server_handlers.go:300,687,696,1054,1278`).
- **Emoji, sticker and pack names and tags** (`0001_init.sql:257,269-270,283-284`).
- **Key-rotation reasons** — a free-text string per epoch (`0001_init.sql:305`,
  written at `internal/api/key_handlers.go:178,197`).
- **Session IP and User-Agent** (`0001_init.sql:51-52`), and **guest display names
  and IPs** (`internal/db/migrations/0010_guest_calls.sql:22,26`).
- **Every URL a client asks to preview.** Link unfurling is server-side
  (`internal/api/unfurl_handlers.go:21-61`); the client extracts URLs from
  decrypted text and asks the server to fetch them. The server never sees the
  surrounding text, but it sees the URL, attributed to the requesting user. Preview
  images are then fetched through the server's own proxy
  (`internal/api/proxy_handlers.go:50-60,105`).
- **GIF search queries**, forwarded verbatim to a third party (Klipy) and cached
  server-side by query string (`internal/api/expression_handlers.go:775,790,801`).
- **Rich-presence / activity text** — name, details, state, asset text, button
  labels and URLs all traverse the gateway in the clear and are parsed server-side
  (`internal/gateway/activity.go:21-36,291`).
- **Read positions and typing events** (`0001_init.sql:212-218`,
  `internal/api/channel_handlers.go:375-382`).
- **Client crash reports**: exception message, stack, React component stack and
  `location.pathname` (which encodes server and channel ids), per user
  (`web/src/lib/crashReport.ts:44-53`, stored at `internal/store/errors_log.go:36`).
- **Access logs** include the request path, and the reaction routes put the emoji in
  the URL (`internal/api/middleware.go:69`, route at
  `internal/api/message_handlers.go:35`).
- **TOTP secrets are not end-to-end encrypted** — they are sealed with the *server's*
  secret and are therefore server-readable
  (`internal/db/migrations/0004_mfa.sql:2-10`).
- **Subchat "passwords" are an ACL, not encryption.** The migration says so
  plainly: "The messages stay encrypted with the conversation's keys either way"
  (`internal/db/migrations/0011_subchat_locks.sql:4-5`). Anyone with the
  conversation key can read a locked subchat's messages.

Things the server notably cannot do: there is **no server-side message search** (no
FTS table, no plaintext body column), **no push service** (no webpush/FCM/APNs
anywhere in `internal/` — notifications are built in the client from already
decrypted messages, `web/src/lib/notify.ts:129`), and **no decoding of encrypted
attachments** (`internal/media/store.go:155-174` stores them with a hardcoded
`application/octet-stream` and no sniffing, and both the variant and public paths
hard-refuse `b.Encrypted` — `internal/media/handler.go:19`,
`internal/media/variants.go:75`).

---

## Findings

### [CRITICAL] The server picks whose public keys the conversation key is wrapped for, and no client ever verifies an identity key

- **Where**:
  - `web/src/stores/keys.ts:31-36` (`publicKeyOf` — server-supplied), `:49-67`
    (`putGrantsFor`), `:151-155` (`grantTo`), `:156-165` (`reconcile`)
  - `web/src/gateway/dispatch.ts:265` — `case "keys_needed": ... grantTo(e.d.conv_id, e.d.epoch, e.d.user_ids)`
  - `web/src/gateway/dispatch.ts:127` — `reconcile()` runs on every gateway ready
  - `android/app/src/main/java/xyz/evilion/chat/data/KeyService.kt:125-140` (`putGrantsFor`, `publicKeyOf`), `:151-169` (`grantTo`, `reconcile`)
  - `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:658` — `reconcile()` on connect
  - Server side that feeds it: `internal/api/key_handlers.go:35-42` (`/keys/needs`), `internal/store/keys.go:283-317` (`Needs`), `internal/api/user_handlers.go:347-358` (`/users/{id}/public-key`)
  - Absent everywhere: any fingerprint / safety-number / key-change UI. I searched
    `web/src`, `android/app/src/main`, `internal` and `desktop/src` for
    `fingerprint`, `safetyNumber`, `safety_number`, `verifyKey`, `keyVerif`, `tofu`
    — every hit was about pinned *messages*.
- **What**: A client learns a member's x25519 public key only by asking the server
  (`usersApi.publicKey`, or the cached `public_key` field the server sent with the
  user object). It then seals the conversation root key to that key and uploads the
  grant. Which users to seal for is also the server's answer: `createEpoch` returns
  `user_ids` (`internal/api/key_handlers.go:217`), `/keys/needs` returns
  `user_ids` (`internal/store/keys.go:313`), and the `keys_needed` gateway event
  carries `user_ids` straight into `grantTo`. Nothing is checked against anything
  the user has seen or confirmed.

  The cheapest exploitation is not a key swap at all. The server emits one
  `keys_needed` event naming an attacker-controlled account id. Any online member
  who holds the root wraps it for that account's public key and `POST`s the grant.
  `web/src/stores/keys.ts:151-155` has no filter and no prompt; the UI shows
  nothing. The server now holds a grant it can open.

  The classic key substitution also works and is fully transparent: serve the
  server's own public key from `GET /users/{id}/public-key` to everyone *except* the
  victim, collect the grants sealed to it, decrypt the root, and re-seal the real
  root to the victim's real key so the victim notices nothing.
- **Impact**: The server — the one party the whole product promises is shut out —
  obtains conversation root keys at will, and therefore every message, every
  attachment key and every call key in those conversations, past (grants are stored
  per epoch, `internal/store/keys.go:148-154`) and future. There is no way for a
  user to detect it, because there is nothing in the product that shows a key or a
  key change. A malicious instance operator, an operator compelled by legal process,
  or anyone who achieves write access to the server needs no cryptographic attack
  at all.
- **Confidence**: traced end to end. I followed `keys_needed` from
  `internal/store/keys.go:283` through the gateway event to
  `web/src/stores/keys.ts:151` and `putGrantsFor` at `:49`, and confirmed the
  absence of verification by exhaustive search.
- **Fix**: Three things, in order of value.
  1. Pin identity keys on first use and warn loudly on change. The client already
     stores per-user state; record `user_id -> public_key` the first time it is
     seen and refuse to seal to a changed key without an explicit, blocking user
     confirmation. The server has no legitimate reason to change a user's
     `public_key` — there is no update path for it in the API (register writes it,
     `internal/api/auth_handlers.go:151`; nothing else does), so any change is
     either a re-registration or an attack.
  2. Show a fingerprint. A short hash of the identity public key, in the profile
     card and in DM headers, plus an out-of-band comparison flow. Without a way to
     compare, pinning only catches changes, not a substitution that was there from
     the start.
  3. Do not let the server name the recipients. Derive the grant recipient list
     from membership the client already knows about and displays, and treat a
     `keys_needed` naming someone outside it as hostile. At minimum, cross-check
     `n.user_ids` against the conversation's member list before wrapping.

### [HIGH] Both clients accept argon2id cost parameters from the server with no floor

- **Where**:
  - `web/src/stores/auth.ts:175-176` — `const kdf = await authApi.kdf(username); ... deriveAll(password, b64.dec(kdf.salt), toParams(kdf.params))`
  - `web/src/stores/auth.ts:88-90` — `toParams` copies `m`, `t`, `p` verbatim, no validation
  - `web/src/stores/auth.ts:207`, `:326`, `:342` — same for unlock, password change, recovery-key replacement
  - `android/app/src/main/java/xyz/evilion/chat/data/Session.kt:147-150` — `Kdf.Params(kdf.params.m, kdf.params.t, kdf.params.p)`, likewise unvalidated; also `:189`, `:289`
  - `web/src/lib/subchatLock.ts:53-55` — the subchat password takes `info.params` from the server too
  - The server's own floor exists but only applies to what a client *submits*: `internal/api/auth_handlers.go:33-39` (`validKDF`, `m >= 32768`, `t >= 2`), enforced at `:136`, `:370`, `:431`. Nothing constrains what `GET /api/v1/auth/kdf` *returns* (`:187-199`).
- **What**: On every sign-in the client asks the server for the salt and the argon2id
  parameters and uses them as given. A server that returns `{"m":8,"t":1,"p":1}`
  makes the client's stretching effectively free. The client then computes
  `authKey = HKDF(argon2id(password, salt, params), "evilion-chat/auth/v1")` and
  **sends that auth key to the server**.
- **Impact**: A malicious or compromised server recovers the *plaintext password*
  from a single login by brute-forcing against the weak parameters it chose — a few
  million guesses per second instead of a few per second. With the password it then
  derives the real `encKey` using the real stored salt and parameters and unwraps
  `enc_private_key`, which it already holds
  (`internal/db/migrations/0001_init.sql:29`). That yields the identity private key,
  hence every grant, hence everything. Attacker: the server, or anyone who gets one
  write to the `users` row. This does not require the CRITICAL above, and it
  survives fixing it.
- **Confidence**: traced. The client-side path is unambiguous; I read `toParams`,
  `deriveAll` and the Android equivalent. I have not built a proof-of-concept
  cracker, so the speed-up factor is an estimate, not a measurement.
- **Fix**: Apply the same floor client-side that the server applies to submissions.
  In `toParams` (`web/src/stores/auth.ts:88`) and `Session.kt:147`, reject anything
  below `m = 32768`, `t = 2`, `p >= 1`, `v == 1`, and cap the upper end so a hostile
  server cannot wedge the client with `m = 2^20, t = 20` either. Do the same in
  `subchatLock.ts`. The constants already exist on the server
  (`internal/api/auth_handlers.go:38`); mirror them into the shared crypto module so
  all three implementations use one definition.

### [HIGH] Rotation does not stop a removed member reading new messages

- **Where**:
  - `internal/api/message_handlers.go:152-156` — the server rejects `env.Epoch > latest` but accepts any epoch at or below it
  - `web/src/stores/keys.ts:124-128` — `ensureConvKey` returns `ring.latest(conv)`, the newest epoch *this device holds*; it never asks the server what the newest epoch is
  - `web/src/components/composer/send.ts:53-57` — that epoch is what encrypts the message
  - `android/.../data/KeyService.kt:91-92` — `ring.latest(conv)?.let { return it }`, same behaviour
  - Rotation triggers: `internal/api/group_handlers.go:156,203`, `internal/api/server_handlers.go:200,445`, `internal/api/channel_handlers.go:370`
- **What**: When someone is removed, the server flags the conversation and asks
  holders to rotate. That produces a new epoch and new grants. But a device that has
  not yet received a grant for the new epoch keeps encrypting under the old one, and
  the server happily stores it. A phone that has been asleep, a tab that is offline,
  a second device that has not synced — each keeps writing under the stale epoch
  indefinitely, and there is nothing that tells it to stop or that it is behind.
- **Impact**: A removed member who kept their copy of the old root (they had it
  legitimately; nothing can take it back) reads messages written *after* their
  removal, for as long as any member's device lags. The product's removal semantics
  are therefore best-effort, not enforced. Attacker: a former member, which is
  exactly the case rotation exists for.
- **Confidence**: traced. I confirmed the server's acceptance rule at
  `message_handlers.go:152-156` and both clients' "newest I hold" behaviour.
- **Fix**: Have the server refuse writes under an epoch older than the latest
  (optionally with a short grace window for in-flight sends), and return the latest
  epoch number to clients so a lagging device knows to block and fetch its grant
  rather than encrypt under a key the removed member holds. The client already has a
  "waiting for keys" state (`web/src/stores/keys.ts:176`) — reuse it.

### [MEDIUM] The data export writes the passcode verifier into an unencrypted zip

- **Where**: `web/src/lib/export.ts:165` — `entries.push({ name: "settings.json", data: json(useSettings.getState().settings) })`; the settings document includes `appLock: AppLockPolicy | null` (`web/src/stores/settings.ts:84`), whose shape is `{salt, params, verifier, ...}` (`web/src/stores/settings.ts:42-51`), built at `web/src/lib/appLock.ts:187-197`. The zip is stored uncompressed and unencrypted (`web/src/lib/export.ts:39`) and dropped into the OS Downloads folder (`:191-201`).
- **What**: `verifier` is `HKDF-SHA256(passcodeKey, info="evilion-chat/app-lock-verify/v1")` (`web/src/lib/appLock.ts:140-142`). Salt, parameters and verifier together are precisely what an offline attacker needs to brute-force the passcode. The passcode minimum is four characters (`web/src/lib/appLock.ts:24`), and the record even records whether it is all digits (`:65,180`), which narrows a numeric passcode to 10,000 candidates.
- **Impact**: A device thief, or anyone who reads the Downloads folder or a backup of it, recovers the device passcode offline. Combined with the `ec.lock.<userId>` localStorage record (which holds the passcode-wrapped identity private key, `web/src/lib/appLock.ts:46-66,110`), that yields the identity private key and every conversation the account can read. The export also contains every decrypted message body (`web/src/lib/export.ts:145`), which is the point of an export — but the key material is not.
- **Confidence**: traced. I read the export entry, the settings type and the verifier derivation.
- **Fix**: Strip `appLock` (and anything else key-adjacent) from the settings object before it is serialised into the export. A `redactForExport(settings)` helper is a two-line change.

### [MEDIUM] The AAD binds the channel and author but not the message, so replay, edit-rollback and metadata tampering all go undetected

- **Where**:
  - `web/src/crypto/message.ts:53-55` — `` aadBytes = utf8.enc(`${a.conv}|${a.epoch}|${a.channelId}|${a.authorId}`) ``
  - `android/.../crypto/MessageCrypto.kt:92` — `"${a.conv}|${a.epoch}|${a.channelId}|${a.authorId}".toByteArray()` (identical)
  - `web/src/lib/decrypt.ts:28-33` — the AAD is rebuilt from server-supplied fields
  - Everything left out: `internal/db/migrations/0001_init.sql:163,170-178` (`id`, `reply_to_id`, `mentions`, `mention_roles`, `mention_everyone`, `flags`, `nonce`, `edited_at`, `created_at`)
- **What**: Moving a ciphertext to another channel or attributing it to another
  author fails the tag — that part works, and the Android test at
  `CryptoTest.kt:74-81` proves it. But nothing binds a ciphertext to *a particular
  message*. The server can:
  - re-insert the same ciphertext as a new message in the same channel by the same
    author (replay), with a fresh id and timestamp;
  - restore an earlier ciphertext of an edited message (edit rollback), since both
    versions encrypt under the same AAD;
  - change `reply_to_id` so a message appears to answer something else;
  - add or remove entries in `mentions` / `mention_everyone`, changing who is
    notified and highlighted;
  - flip `flags` (pinned, suppress-embeds) and rewrite `created_at` / `edited_at`,
    reordering the conversation.
  The settings blob has the same shape of gap: its AAD is the constant
  `"settings/v1"` (`web/src/lib/settingsCrypto.ts:4`) with no user id and no
  version, and while an in-session rollback is rejected
  (`web/src/stores/settings.ts:264`), a fresh session accepts whatever version the
  server serves.
- **Impact**: A malicious server rewrites the apparent shape of a conversation
  without ever breaking a tag: duplicated messages, reverted edits, mis-threaded
  replies, fabricated or suppressed notifications, reordered history. It cannot
  produce new plaintext, which is the important limit — but a reader has no way to
  tell a tampered transcript from a real one.
- **Confidence**: traced for the AAD contents and the plaintext columns. The
  settings-rollback path across sessions is **needs confirmation** — I read
  `load()` at `web/src/stores/settings.ts:260-267` but did not exercise it.
- **Fix**: Put the message id in the AAD. The id is assigned by the server, so it is
  not available at encryption time — the usual answer is to have the client mint a
  random per-message id (it already mints a `nonce`, `web/src/lib/ids.ts:30`), bind
  that into the AAD, and have the server store and return it. Binding `reply_to_id`,
  the mention list and `created_at` as well closes the metadata tampering. For
  settings, add the user id and the version to the AAD.

### [MEDIUM] In the default configuration the identity private key and every conversation root sit unencrypted on disk

- **Where**: `web/src/crypto/keystore.ts:1-9` (the file says so itself: "Everything here is plaintext at rest inside the browser profile"), `:126-133` (`saveIdentity` stores raw `privateKey` bytes), `:142-149` (`saveRoot`); written only when no passcode is set — `web/src/stores/auth.ts:95-97`. On desktop this is the same store, because the desktop app loads the live site (`desktop/src/main/window.ts:129`, `desktop/src/main/config.ts:17,22`) rather than a local bundle.
- **What**: Unless the user turns on a passcode, IndexedDB `evilion-chat` holds the x25519 private key and all conversation root keys in the clear. On desktop that is a leveldb under `~/Library/Application Support/Nexa/IndexedDB/` (macOS), `%APPDATA%\Nexa\` (Windows) or `~/.config/Nexa/` (Linux), readable by any process running as the user. The Electron app uses no `safeStorage`, no keychain, no DPAPI — I searched `desktop/` for `safeStorage|keytar|encryptString` and found nothing. The session bearer token sits beside it in localStorage as `ec.token` (`web/src/stores/auth.ts:31,93`), in the clear.
- **Impact**: Anyone with filesystem access as that user — a stolen laptop with no
  disk encryption, a backup, a piece of malware, another user on a shared machine —
  reads every conversation key and the account token. Android is better here:
  `SecureStore` seals the same material with an AndroidKeystore-held AES key
  (`android/.../data/SecureStore.kt:135-162`), though it falls back to writing the
  vault in the clear if the keystore refuses (`:89`), and it sets neither
  `setUserAuthenticationRequired` nor `setUnlockedDeviceRequired`, so an attacker who
  can run code as the app still gets it.
- **Confidence**: traced.
- **Fix**: On desktop, wrap the IndexedDB payload with a key held in
  `safeStorage` (Electron's `encryptString`/`decryptString`) before it is written —
  it binds to the OS keychain/DPAPI and costs nothing at runtime. On the web there
  is no equivalent, so the honest move is to make the passcode the default rather
  than an option, and say plainly in the UI what "no passcode" means. On Android,
  add `setUnlockedDeviceRequired(true)` to the `KeyGenParameterSpec`.

### [MEDIUM] Production desktop builds ship DevTools, no Electron fuses, and an unguarded key-store override

- **Where**:
  - `desktop/src/main/window.ts:185` — `{ role: "toggleDevTools" }` in the macOS View menu, with no `app.isPackaged` guard
  - `desktop/src/main/index.ts:19` — `if (process.env.EVILION_USER_DATA) app.setPath("userData", process.env.EVILION_USER_DATA)`, also ungated
  - No `@electron/fuses` dependency anywhere in `desktop/`; `electron-builder.yml` has `identity: "-"` (ad-hoc), `hardenedRuntime: false`, `gatekeeperAssess: false`, and `nsis.deleteAppDataOnUninstall: false`
- **What**: On macOS the shipped app has a DevTools menu item (and ⌥⌘I). One click
  and `localStorage.getItem("ec.token")` plus the IndexedDB `identity` record are
  readable in the console. Windows and Linux null the menu
  (`desktop/src/main/window.ts:156`), which removes the accelerator. Separately,
  `EVILION_USER_DATA` relocates the whole profile — identity key, token, wrapped
  passcode record — to any directory the launcher chooses, in packaged builds. With
  no fuses and no hardened runtime, `ELECTRON_RUN_AS_NODE=1`, `--inspect` and a
  plain debugger attach all work against the signed binary, which reaches
  *unwrapped* keys in renderer memory regardless of what is done at rest.
- **What is right**: the window itself is locked down properly —
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true` (`desktop/src/main/window.ts:74-77`), navigation confined to
  the origin (`:95-107`), an origin-checked preload bridge
  (`desktop/src/preload/index.ts:24-25`, re-checked at
  `desktop/src/main/index.ts:57-59`), and real permission handlers
  (`desktop/src/main/permissions.ts:18,36,43,161`).
- **Impact**: A device thief or a local attacker gets the token and the keys with no
  cryptographic work. Attacker: anyone with brief physical or local access.
- **Confidence**: traced for the code citations. The fuse/signing consequences are
  standard Electron behaviour rather than something I executed — **needs
  confirmation** by trying `ELECTRON_RUN_AS_NODE=1` against a packaged build.
- **Fix**: Guard `toggleDevTools` and `EVILION_USER_DATA` on `!app.isPackaged`. Add
  `@electron/fuses` and disable `RunAsNode`, `EnableNodeCliInspectArguments`,
  `EnableNodeOptionsEnvironmentVariable`, and turn on `EnableEmbeddedAsarIntegrityValidation`
  and `OnlyLoadAppFromAsar`. Turn on `hardenedRuntime` and sign properly.

### [MEDIUM] The native call-frame AES is a T-table implementation, which leaks the key to cache timing

- **Where**: `android/app/src/main/cpp/aes_gcm.cc:30-48` (the four T-tables), `:125-158` (`EncryptBlock`, indexing `te0..te3` and `kSbox` by key-dependent bytes), `:80-81` and `:161-189` (the 4-bit-window GHASH, also table-driven)
- **What**: The header explains the constraint honestly — "The NDK exposes no crypto
  library an app may link against" (`aes_gcm.h:3-4`) — and the implementation is
  correct (see the closing section: it passes all NIST AES-256-GCM vectors). But
  table lookups indexed by key-dependent data are the textbook cache-timing target
  (Bernstein; Osvik–Shamir–Tromer). The tables are a shared `static const`
  (`aes_gcm.cc:45-48`), so every call in the process shares the same cache lines.
- **Impact**: A malicious app co-resident on the same Android device that can observe
  cache state while a call is running could, in principle, recover the voice frame
  key and decrypt that call's audio and video. This is a hard attack on a modern
  phone and I am not claiming it is practical today; it is a real weakening of a key
  that protects live conversation. Attacker: local malware. It does **not** help the
  server or a network attacker.
- **Confidence**: traced as to what the code does. The exploitability is a
  well-established class of attack, not something I demonstrated — **needs
  confirmation** if you want to weigh it precisely.
- **Fix**: Use hardware AES. `ARMv8-A` Cryptography Extensions (`vaeseq_u8`,
  `vaesmcq_u8`, `vmull_p64` for GHASH) are present on essentially every 64-bit
  Android device shipped in the last decade, are constant-time, and are far faster
  than the tables; keep the current implementation as a runtime fallback behind
  `getauxval(AT_HWCAP)`. Alternatively link a vendored BoringSSL. Either way, the
  format does not change, so the byte-for-byte agreement established below is
  preserved.

### [MEDIUM] Attachment truncation is not detected on Android, and `decryptFile` does not detect it either

- **Where**:
  - `android/.../crypto/FileCrypto.kt:92-111` — `decryptStream` loops until the input ends; it authenticates each chunk but never compares the total against the declared plaintext size
  - `android/.../media/AttachmentStore.kt:45-58` — the caller passes `meta.size` only to the progress callback, never as a check
  - `web/src/crypto/file.ts:50-63,65-99` — `scanChunks` accepts any number of chunks and any `len >= TAG_LEN`; `decryptFile` computes the total *from the spans it found*, so a short file is simply a short file
  - Contrast with the streaming path, which does it right: `web/src/crypto/streamDecrypt.ts:180-185` — `if (len !== plainLen + TAG_LEN) throw new FileCorrupt(...)`, with `count` derived from the authenticated `size`, plus the trailing check at `:200-202`
- **What**: Chunk `i` is bound to its position by `iv = baseIv ‖ u32be(i)`
  (`web/src/crypto/fileChunks.ts:58`, `android/.../FileCrypto.kt:41`), so chunks
  cannot be reordered or spliced from another file. But dropping chunks off the
  *end* breaks nothing: each surviving chunk still authenticates. The web is rescued
  by its caller — `web/src/api/channels.ts:99-121` enforces the exact expected
  ciphertext length from `encryptedSize(att.size)` and rejects a mismatch — but
  `decryptFile` itself has no such guard, and Android has no guard at any layer.
- **Impact**: A malicious server silently truncates a downloaded attachment. The
  user gets a shorter document, a cut-off recording, a half image, with no error.
  Attacker: the server. Confidentiality is unaffected.
- **Confidence**: traced. The web caller's length check is real and I read it; the
  Android path genuinely has none.
- **Fix**: Pass the declared plaintext size into `FileCrypto.decryptStream` and
  `decryptFile` and require `written == size` and `chunkCount(size)` chunks, the way
  `streamDecrypt.ts` already does. The size is already authenticated — it rides
  inside the encrypted message payload (`AttachmentMeta.size`,
  `web/src/crypto/message.ts:36`).

### [MEDIUM] Revoking a guest link does not rotate the call key

- **Where**: `internal/api/guest_handlers.go:194-221` (`handleGuestLinksRevoke`), `:224-246` (`handleGuestLinkRevoke`) — both drop the guest from the call (`dropGuest`) but never touch `SetKeyFlags` / `key_rotation_needed`. Compare the paths that do rotate: `internal/api/group_handlers.go:156,203`, `internal/api/server_handlers.go:200,445`, `internal/api/channel_handlers.go:370`. The key itself: `web/src/lib/guestLink.ts:37` — the link's fragment carries `voiceFrameKey(latest.root, channelId)`.
- **What**: A guest link hands out the channel's call key for an epoch, in the URL
  fragment. Revoking the link, or letting it expire, removes the guest's server-side
  access — but the key they were given still opens frames of that channel's calls
  under that epoch, and nothing rotates the conversation. It rotates only when an
  unrelated membership change happens.
- **Impact**: Anyone who ever held a guest link — or saw it in a chat log, a browser
  history, a screenshot — can decrypt that channel's call media indefinitely,
  provided they can reach the frames. They still need the SFU to send them frames,
  which the server controls, so this is a defence-in-depth failure rather than a
  direct read; but the design's own claim is that the key is what protects the media,
  not the ACL.
- **Confidence**: traced — I read both revoke handlers and confirmed the absence of
  a rotation call by comparing against every `SetKeyFlags` call site.
- **Fix**: Flag the conversation for rotation when the last guest link for a channel
  is revoked or expires, the same way member removal does.

### [MEDIUM] The call key index is the epoch's low byte, so epoch 5 and epoch 261 collide

- **Where**: `web/src/voice/e2ee.ts:35-36` — `index: epoch & 0xff`, `send: newest & 0xff`; `web/src/voice/guestKeys.ts:42` — same; `web/src/voice/frameCrypto.worker.ts:164,167` — `next.set(k.index & 0xff, ...)`, `sendIndex = msg.send & 0xff`; `web/src/voice/frameCrypto.ts:55` — `out[out.length - 1] = index & 0xff`; `android/.../data/KeyService.kt:189,191` — `(epoch and 0xff)`; `android/app/src/main/cpp/sealed_frame.cc:25` — `out[body + kIvLen] = uint8_t(key_index & 0xff)`
- **What**: The trailing byte of a sealed frame names which epoch's key opens it, and
  it is only eight bits. Every membership change rotates the epoch
  (`internal/api/server_handlers.go:445` and friends), so a busy server reaches 256
  rotations in ordinary use. Once it does, a device holding both epoch 5 and epoch
  261 collapses them into one map entry — last one wins in the JS `Map`
  (`frameCrypto.worker.ts:164`) and in the C++ `std::map` (`frame_crypto.cc:36-38`).
- **Impact**: Frames sealed under the older of two colliding epochs are attempted
  with the wrong key, fail the tag, and are dropped
  (`frameCrypto.worker.ts:120-123`, `frame_crypto.cc:164`). The failure is
  fail-closed — nothing is played in the clear — so this is availability, not
  confidentiality: calls silently lose audio or video from some participants with no
  diagnosable cause.
- **Confidence**: traced through all four implementations. I have not reproduced it
  with 256 real epochs, so the *frequency* in practice is **needs confirmation**.
- **Fix**: Widen the index to two bytes, or key the map on the full epoch and send a
  short per-call index table alongside the keys. Either way it is a wire-format
  change and needs a version bump; the frame trailer has no version byte today,
  which is itself worth fixing while you are in there.

### [LOW] The AAD is a `|`-joined string with no length prefixes

- **Where**: `web/src/crypto/message.ts:53-55`; `android/.../crypto/MessageCrypto.kt:92`; the guest relay AAD has the same shape at `web/src/voice/guestKeys.ts:51-53` (`` `guest-key:${channelId}:${guestId}:${epoch}` ``)
- **What**: `${conv}|${epoch}|${channelId}|${authorId}` is unambiguous only because
  every field is a numeric snowflake today (`internal/ids`), so none can contain a
  `|`. Nothing enforces that. If a future id type, a guest id, or a channel key ever
  admits the separator, two different tuples can produce the same AAD, and a message
  becomes movable between contexts.
- **Impact**: Nothing exploitable now. It is a latent break waiting for an id format
  change.
- **Confidence**: traced. Not currently exploitable — ids are integers.
- **Fix**: Length-prefix each field, or use a canonical encoding that cannot be
  confused. Since this changes the AAD bytes it needs an envelope version bump, so
  it is best done alongside the message-id binding above.

### [LOW] The passcode verifier is compared with `!==`, not in constant time

- **Where**: `web/src/lib/appLock.ts:206` — `if (verifierOf(key) !== policy.verifier)`. The codebase has a constant-time comparison right there for the taking: `web/src/crypto/bytes.ts:68-73` (`equal`), mirrored at `android/.../crypto/Bytes.kt:41-46`, and the server uses `subtle.ConstantTimeCompare` correctly at `internal/auth/password.go:63`.
- **What**: Comparing a secret-derived verifier with JavaScript string `!==` leaks
  through timing in principle.
- **Impact**: Very low. The attacker would need to measure the comparison inside the
  victim's page, and knowing the verifier does not unlock anything (the comment at
  `appLock.ts:137-139` is right about that) — the exposure is narrowing a passcode
  search, which the exported verifier (see the MEDIUM above) hands over outright
  anyway.
- **Confidence**: traced.
- **Fix**: `equal(hkdfBytes, b64.dec(policy.verifier))` using the existing helper.

### [LOW] Android mints the message idempotency nonce with a non-cryptographic RNG

- **Where**: `android/.../data/MessageService.kt:297-300` — `repeat(16) { append(chars[Random.nextInt(16)]) }`, with `import kotlin.random.Random` at `:28`
- **What**: `kotlin.random.Random.Default` is a seeded XorWoW generator, not a
  CSPRNG. The web does this correctly — `web/src/lib/ids.ts:30-34` uses
  `crypto.getRandomValues` for 12 bytes — so this is also a cross-implementation
  inconsistency, not just a weak generator.
- **Impact**: None today — the nonce is a dedup token, unique-indexed per
  `(channel_id, author_id, nonce)` (`internal/db/migrations/0001_init.sql:182`), not
  a cryptographic value. It matters only because a predictable nonce lets someone
  who can write to the API pre-claim a victim's next nonce and block a send, and
  because if this value is ever promoted into the AAD (as the fix above suggests) it
  must be unpredictable.
- **Confidence**: traced.
- **Fix**: `Bytes.random(8)` and hex it — the CSPRNG is already there at
  `android/.../crypto/Bytes.kt:8-10`.

### [LOW] Invite and guest keys linger in sessionStorage and in URL history

- **Where**: `web/src/pages/InvitePage.tsx:32-34` (`ec.inviteKey.${code}`), `:59-66` (written), `:113` (deleted only on a successful accept); the fragment resolves to a conversation root key via `web/src/lib/inviteLink.ts:26-36`. Guest side: `web/src/pages/GuestCallPage.tsx:42,55` (`ec.guest.${code}`, a guest bearer token).
- **What**: The comment at `InvitePage.tsx:28-31` explains the design honestly — the
  key cannot ride in a query string because that reaches the server in the Referer —
  so it goes in the fragment and is parked in sessionStorage across a login. If the
  visitor abandons the invite, the root key stays in sessionStorage for the tab's
  life. The fragment also lands in browser history and, on shared or synced
  browsers, travels.
- **Impact**: A conversation root key sitting in a place the user does not know
  about. Attacker: anyone with the device or the browser profile.
- **Confidence**: traced.
- **Fix**: Clear `ec.inviteKey.*` on any terminal outcome, not only success, and add
  a `beforeunload` sweep. Consider replacing the fragment as soon as it is read
  (`history.replaceState`) so it does not persist in history.

### [LOW] Notification bodies put decrypted message text into the OS notification store

- **Where**: `web/src/lib/notify.ts:129` — `showNotification(title, { body: previewOf(m), ... })`; `previewOf` returns up to 140 characters of decrypted text (`:96-104`)
- **What**: On desktop and mobile the notification body is handed to the operating
  system, which persists it (on macOS, `~/Library/Group Containers/group.com.apple.usernoted/db2/db`).
  This is outside the app's control once sent.
- **Impact**: Decrypted message content at rest in an OS database the app cannot
  clear. Attacker: anyone with the device. This is the normal trade-off every
  messenger makes, but it should be a setting and it should be stated.
- **Confidence**: traced on the client side; the OS persistence behaviour is
  platform fact, not something I verified here.
- **Fix**: Offer a "hide message content in notifications" setting, as Signal and
  iMessage do.

### [LOW] A member can plant a junk grant and lock another member out of an epoch

- **Where**: `internal/store/keys.go:98` — `INSERT ... ON CONFLICT DO NOTHING`; the acknowledgement of the risk is at `internal/api/key_handlers.go:112-115` ("junk shared from it would block the real key, since the first grant stored wins")
- **What**: The self-grant case is handled (`key_handlers.go:98-107`), but a
  legitimate holder can still `POST` a malformed `wrapped_key` for another member.
  First write wins, so the victim can never receive the real grant for that epoch.
- **Impact**: A member denies another member access to a conversation epoch. Not a
  confidentiality break. It is also loud — the victim sees "waiting for keys".
- **Confidence**: traced.
- **Fix**: Let a grant be replaced by a *different* wrapper (keep the newest per
  `(conv, epoch, user, wrapped_by)` rather than the first), or let the recipient
  report an unopenable grant so another holder can overwrite it.

### [LOW] Android caches decrypted attachments in the clear, under their plaintext filenames

- **Where**: `android/.../media/AttachmentStore.kt:31` (`File(context.cacheDir, "attachments")`), `:36-39` (`fileFor` names the file `"${meta.blobId}-$safe"` where `safe` is derived from `meta.name`), `:55` (`decryptToFile`)
- **What**: Decrypted attachments are written to app-private cache storage in the
  clear and are not covered by the `SecureStore` keystore sealing that protects the
  identity key and roots (`android/.../data/SecureStore.kt`). The filename itself
  discloses the plaintext name.
- **Impact**: A rooted device, a device-backup extraction, or an app-data dump
  reveals downloaded files and their names. Attacker: a device thief with root, or
  malware with the app's uid.
- **Confidence**: traced.
- **Fix**: At minimum strip the name from the cache filename. Better: keep the cache
  inside a directory covered by the keystore-sealed vault, or clear it on sign-out
  (the current `clear()` at `SecureStore.kt:130-133` does not touch it).

### [HARDENING] Call-frame IV uniqueness rests on a 64-bit random salt, argued by birthday bound

- **Where**: `web/src/voice/frameCrypto.ts:28` (`SALT_BYTES = 8`), `:37-42` (`frameIv`), `web/src/voice/frameCrypto.worker.ts:62` (salt per worker), `:101-104` (re-salt before overflow); `android/app/src/main/cpp/frame_crypto.cc:99` (salt per encryptor), `:114-121`
- **What**: Every participant in a call shares one AES key —
  `voiceFrameKey(root, channelId)` (`web/src/crypto/conv.ts:29-31`) — and
  distinguishes their IVs only by an 8-byte random salt followed by a 32-bit
  counter. The counter logic is correct on both platforms: the web increments
  synchronously before the `await` (`frameCrypto.worker.ts:111`, single-threaded, so
  no interleaving) and re-salts at `counter > 0xffffffff`; the C++ uses
  `fetch_add` and re-salts when it returns `0xffffffff`, with the current frame
  still using the old salt and the natural `uint32` wrap taking the counter back to
  zero. So within one sender, IVs never repeat.

  Across senders, the guarantee is a birthday bound: with *N* independent
  (sender, session) pairs under one key, the chance any two pick the same salt is
  roughly *N²/2⁶⁵*. For any realistic *N* that is negligible, but it is a
  probabilistic argument, not a construction, and the key is long-lived — it changes
  only when the conversation epoch does.
- **Confidence**: traced, including the overflow arithmetic on both platforms.
- **Fix**: If you want a hard guarantee rather than a bound, derive a per-sender key
  (`HKDF(voiceKey, info = sender-id)`) or carve a participant index out of the IV.
  Both are wire-format changes.

### [HARDENING] The C++ encryptor re-randomises its salt without synchronisation

- **Where**: `android/app/src/main/cpp/frame_crypto.cc:115-117` — `memcpy(iv, salt_, kSaltLen)` then, two lines later, `RandomBytes(salt_, kSaltLen)` on another path, with `salt_` a plain `uint8_t[8]` (`:141`) while `counter_` is an `std::atomic` (`:142`)
- **What**: If `Encrypt` is ever called concurrently on one `Encryptor` (simulcast
  layers, an encoder that fans out), the re-salt is a data race against the
  `memcpy`, and a torn read could produce a half-old, half-new salt.
- **Impact**: Only reachable after 2³² frames on one sender — years of continuous
  audio — and a torn salt would most likely still be unique. It is undefined
  behaviour, which is reason enough.
- **Confidence**: traced. One `Encryptor` is created per publish kind
  (`android/.../voice/SfuTransport.kt:206`), so in the common case there is a single
  caller thread; **needs confirmation** whether libwebrtc ever calls it concurrently
  for a simulcast sender.
- **Fix**: Hold the salt and counter together in one atomic 64-bit value, or guard
  the re-salt with the existing mutex.

### [HARDENING] A resumable upload re-reads the file from disk under the same key and base IV

- **Where**: `web/src/lib/attachments.ts:167-168` (key and base IV minted once per upload), `:282` (each retry rebuilds the piece from `file`), `:86` (`encryptChunks`); `android/.../media/Uploads.kt:104-105`, and `ChunkReader.chunk` at `:220-251`, which reopens the stream when it has to seek backwards (`:225-230`)
- **What**: The design is deliberate and documented — same key, same IV, same bytes
  gives the same ciphertext, which is what makes resume work
  (`web/src/crypto/fileChunks.ts:11-16`). It is safe *provided the bytes do not
  change*. If the user edits or replaces the file on disk mid-upload, a chunk index
  can be re-encrypted with different plaintext under the same key and IV, which is
  the catastrophic AES-GCM failure: the XOR of the two plaintexts falls out, and the
  GHASH authentication key is recoverable.
- **Impact**: Requires an unusual user action and yields only that one file's
  plaintext to whoever holds both ciphertexts (the server). Low likelihood, severe
  consequence.
- **Confidence**: traced as to the code paths. Whether a browser's `File` handle
  actually serves changed bytes rather than throwing is platform-dependent —
  **needs confirmation**.
- **Fix**: Capture the file's size and `lastModified` when the upload starts and
  abort if either changes; on Android, treat a short read in `ChunkReader.chunk`
  (`:250`, which currently returns `out.copyOf(at)` silently) as a hard failure
  rather than a short chunk.

### [HARDENING] Call frames have no sender authentication and no version byte

- **Where**: `web/src/voice/frameCrypto.ts:48-57` (`sealFrame`), `android/app/src/main/cpp/sealed_frame.cc:18-27`; the trailer is `iv (12) | key index (1)` with nothing else
- **What**: All participants share one symmetric key, so any participant can seal a
  frame that any other will open and play — there is no binding to who sent it. This
  is the usual trade-off for SFU end-to-end encryption and it is not a defect on its
  own, but it should be stated rather than implied. Separately, the frame format
  carries no version byte, which makes the index-width fix above harder than it
  needs to be.
- **Impact**: A participant (including a guest holding a link) can inject media that
  appears to come from another participant, to the extent the SFU will forward it.
  The SFU can also replay and reorder frames freely.
- **Confidence**: traced.
- **Fix**: If sender authentication matters, sign frames with a per-sender key or
  bind the SSRC into the AAD. Add a version byte to the trailer regardless.

### [HARDENING] The passcode failure counter lives in the record it protects

- **Where**: `web/src/lib/appLock.ts:59-60` (`failures` in `LockConfig`), `:243-246` (incremented and persisted into the same localStorage record), `:23` (`MAX_FAILURES = 10`), `:24` (`MIN_PASSCODE = 4`), `:22` (`LOCK_KDF = {m: 65536, t: 6, p: 1}`)
- **What**: The header comment claims "Ten wrong tries throw the wrapped copy away,
  which costs nothing permanent" (`:5-9`). That is an online control. An attacker who
  copies `ec.lock.<userId>` attacks it offline, where the counter is irrelevant and
  can be reset by editing the JSON anyway. Against a four-digit passcode — and the
  record helpfully records `numeric: true` (`:65,180`) — the search is 10,000
  argon2id evaluations at 64 MiB.
- **Impact**: The device passcode is recoverable offline in minutes to hours on
  commodity hardware. Attacker: a device thief.
- **Confidence**: traced. The exact crack time is an estimate, not a measurement.
- **Fix**: Raise the passcode minimum, or say plainly in the UI that a short numeric
  passcode delays rather than prevents. Stop recording `numeric`. The real fix on
  desktop is to bind the wrapped key to `safeStorage` so an offline copy is not
  usable at all.

### [HARDENING] Argon2id parameters are good, but the real floor is the server's

- **Where**: `web/src/crypto/kdf.ts:25` — `DEFAULT_KDF = { m: 65536, t: 3, p: 1, v: 1 }`; `android/.../crypto/Kdf.kt:21` — `Params(m = 65536, t = 3, p = 1)`; `internal/api/auth_handlers.go:38` — the accepted range, `m >= 32768`, `t >= 2`, `p` 1–4
- **What**: 64 MiB / t=3 / p=1 comfortably exceeds the current OWASP minimum
  (19 MiB, t=2, p=1). But the minimum a client may *register* with is 32 MiB / t=2,
  and the server-side hash of the auth key uses 19 MiB / t=2
  (`internal/auth/password.go:19-24`), which is the OWASP floor exactly rather than
  a margin above it.
- **Confidence**: traced.
- **Fix**: Consider raising the server-side parameters, and plan a migration path —
  `KdfParams.v` exists precisely so a future change can be detected
  (`web/src/crypto/kdf.ts:21-22`) but nothing currently re-derives on login when the
  stored parameters are below the current default.

---

## What I checked and found sound

This section is the coverage statement. Where I say "verified" I mean I ran
something, not that I read a comment.

**Cross-implementation agreement — verified by execution, not inspection.**
- `android/app/src/test/java/xyz/evilion/chat/CryptoTest.kt:39-47` pins expected
  base64 outputs "that came out of the web client" (`:26-30`). I recomputed all five
  from the web client's own `@noble/hashes` HKDF and got exact matches:
  `authKey`, `encKey`, `settingsKey`, `channelKey("chan:12345")`,
  `voiceFrameKey("voice:12345")`.
- The one place the two HKDF implementations could have silently diverged is the
  salt: the web passes `new Uint8Array(0)` (`web/src/crypto/kdf.ts:28,42`) while
  Android passes 32 zero bytes (`android/.../crypto/Kdf.kt:81`). RFC 5869 treats
  "no salt" as HashLen zeros, and `@noble/hashes` deliberately does *not* substitute
  for a zero-length array (`web/node_modules/@noble/hashes/src/hkdf.ts:18-23`). They
  agree anyway, because HMAC pads both a 0-byte and a 32-byte key to the same 64
  zero bytes. I confirmed this numerically rather than reasoning about it.
- The hand-written `AesGcm` in `android/app/src/main/cpp/aes_gcm.cc` **passes all six
  NIST AES-256-GCM test vectors** — including the empty-plaintext case, the AAD case,
  the 8-byte IV case and the 60-byte IV case, which exercise the non-12-byte-IV
  GHASH path at `:213-218`. Each vector also round-trips and rejects a one-bit tag
  tamper. This was the highest-risk code in the repository and it is correct.
- A sealed **call frame produced by the C++ `SealFrame`** (`sealed_frame.cc:18-27`)
  is **byte-for-byte identical** to one produced by the web client's `sealFrame`
  (`web/src/voice/frameCrypto.ts:48-57`) for the same key, IV, index and audio frame.
  I compiled the C++ and ran the TypeScript logic against it.
- Endianness matches everywhere it matters: `u32be` (`web/src/crypto/bytes.ts:75-80`)
  vs `Bytes.u32be` (`android/.../crypto/Bytes.kt:31-32`) vs the explicit shifts in
  `frame_crypto.cc:118-121`; `DataView.setUint32` is called without the
  `littleEndian` argument at `web/src/crypto/streamDecrypt.ts:190` and
  `web/src/voice/frameCrypto.ts:40`, which defaults to big-endian, matching.
- Envelope serialisation agrees: Android's `Api.json` sets `encodeDefaults = true`
  (`android/.../net/ApiClient.kt:64-67`) so `v: 1` is not dropped despite being a
  default — the *payload* serialiser with `encodeDefaults = false`
  (`MessageCrypto.kt:90`) is a different instance and only touches plaintext. I
  checked this specifically because the opposite would have broken every Android
  message on the web (`web/src/crypto/message.ts:175` requires `e["v"] === 1`).
- The server's envelope validator agrees on structure and never decodes the
  ciphertext body (`internal/api/message_handlers.go:50-66`, note the discarded `_`
  at `:62`).

**Nonce and IV handling — traced for every site.**
- Messages: fresh `randomBytes(12)` per message (`web/src/crypto/message.ts:62`,
  `android/.../MessageCrypto.kt:95`). Random 96-bit IVs under a per-channel key;
  standard, and the key changes every epoch.
- Settings: fresh `randomBytes(12)` (`web/src/lib/settingsCrypto.ts:8`).
- Wrapped private keys and sealed boxes: fresh IV per operation, and the sealed box
  additionally derives its key from a fresh ephemeral x25519 key
  (`web/src/crypto/keys.ts:45,66-72`), so IV reuse across seals is harmless.
- File chunks: **the counter cannot wrap or repeat**, and I checked this carefully
  because the brief asked. The base IV is 8 random bytes per file
  (`web/src/crypto/fileChunks.ts:24,50-52`), the counter is `u32be(i)` where `i` is
  the chunk index, and the chunk size is 4 MiB (`:22`). Wrapping the counter would
  need 2³² chunks — 16 exabytes — which is not reachable, and the upload limit is
  100 MB (`web/src/lib/attachments.ts:11`). Across files, the key is fresh per file
  (`newFileKey()` at `web/src/lib/attachments.ts:167`,
  `android/.../media/Uploads.kt:104`), so a base-IV collision between two files is
  irrelevant. Within a file, chunk `i` binds to position `i`, which the code's own
  comment claims and which the AAD-and-IV construction actually delivers:
  reordering, dropping from the middle, or splicing from another file all fail the
  tag. (Dropping from the *end* does not — see the MEDIUM above.)
- Call frames: covered in the HARDENING findings; the counter arithmetic is right on
  both platforms and no IV repeats within a sender.
- Guest key relay: fresh `randomBytes(12)` per relayed key
  (`web/src/voice/guestKeys.ts:74`), under a key derived apart from the frame key
  (`relayKey` at `:46-48`) and bound to channel, guest and epoch by the AAD
  (`:50-53`). This is carefully done.

**Key derivation and separation.**
- `INFO_AUTH`, `INFO_ENC`, `INFO_SETTINGS`, `INFO_RECOVERY_AUTH`, `INFO_RECOVERY_ENC`
  are distinct, versioned strings (`web/src/crypto/kdf.ts:30-34`, mirrored at
  `android/.../crypto/Kdf.kt:23-27`). HKDF-Expand with distinct `info` under the same
  PRK yields independent outputs under standard PRF assumptions, so **the
  server-check key and the unwrap key are genuinely independent**: holding
  `authKey` gives nothing about `encKey`. The server stores only
  `argon2id(authKey)` (`internal/auth/password.go:35`), so it does not even hold
  `authKey`.
- Conversation key separation likewise: `chan:${channelId}` vs `voice:${channelId}`
  (`web/src/crypto/conv.ts:21,30`), so a message key never doubles as a call key.
- The sealed-box KEM binds both the ephemeral and the recipient public key into the
  HKDF info (`web/src/crypto/keys.ts:58-60`, `android/.../crypto/Identity.kt:51-52`),
  which is the right construction, and the ephemeral public key is also the AAD
  (`:71`, `:69`). Low-order points are rejected: `@noble/curves` throws
  (`web/src/crypto/keys.ts:84-85`) and BouncyCastle's
  `X25519.calculateAgreement` returns false, which is checked
  (`android/.../crypto/Identity.kt:57`).
- The KDF salt is 16 CSPRNG bytes minted client-side at registration, password
  change and recovery (`web/src/stores/auth.ts:151,303,327`), and the server enforces
  16–64 bytes (`internal/api/auth_handlers.go:136`). The `GET /auth/kdf` endpoint
  returns a deterministic HMAC-derived fake salt for unknown users
  (`internal/api/auth_handlers.go:181-185,195`), which correctly avoids username
  enumeration through salt presence.

**Randomness.** Every source that touches key material is a CSPRNG:
`crypto.getRandomValues` on web with correct 65536-byte chunking
(`web/src/crypto/bytes.ts:58-65`), `java.security.SecureRandom` on Android
(`android/.../crypto/Bytes.kt:8-10`), `arc4random_buf` in the native frame crypto
(`android/app/src/main/cpp/frame_crypto.cc:27-29`), `crypto/rand` on the server
(`internal/auth/password.go:32`). I searched all three platforms plus desktop for
`Math.random`, `java.util.Random`, `kotlin.random`, `math/rand` and seeded
generators. The only hits near anything security-adjacent are gateway backoff jitter
(`web/src/gateway/client.ts:144`, `android/.../net/Gateway.kt:190`) and the Android
message nonce (the LOW above). No key, IV, salt or token comes from a weak generator.

**Constant time.** `web/src/crypto/bytes.ts:68-73` and
`android/.../crypto/Bytes.kt:41-46` are correct constant-time comparisons with an
early length exit, and the length-only short-circuit is fine. The server uses
`crypto/subtle.ConstantTimeCompare` for the auth-key check
(`internal/auth/password.go:63`) and `hmac.Equal` for the registration key
(`internal/api/auth_handlers.go:119`). The native GCM tag check is constant-time by
construction (`aes_gcm.cc:272-274`, accumulating with `|=`). Login and recovery both
have a 300 ms timing floor (`internal/api/auth_handlers.go:210-214,304-306`), which
also covers the "does this user exist" difference. The recovery key itself is checked
by the same `VerifyAuthKey` path, so it is constant-time. The one lapse is the
passcode verifier (the LOW above).

**Authentication and AAD, what works.** A message cannot be moved to another channel
(the Android test proves it, `CryptoTest.kt:74-81`), cannot be re-attributed to
another author, and cannot be opened under another epoch — all four fields are in the
AAD. Author attribution is cryptographically bound, not merely asserted by the
server: a member cannot forge a message as another member, because the server stamps
`author_id` from the session (`internal/api/message_handlers.go:270`) and the client
rebuilds the AAD from that stamp, so a mismatched AAD simply fails to decrypt.
Forgery would require the server and a key-holding member to collude. The limits on
this are the MEDIUM finding above.

**Error handling and downgrade.** Decryption failures are handled well. Every failure
collapses to one opaque `DecryptError` with a fixed message
(`web/src/crypto/keys.ts:22-27`, `android/.../crypto/Bytes.kt:56`), and the callers
distinguish only "no key" from "bad" (`web/src/lib/decrypt.ts:5`) — a bad tag is
indistinguishable from a malformed blob, which is what the comment at
`web/src/crypto/aes.ts:5-7` promises. `decryptForStore` never throws
(`web/src/lib/decrypt.ts:12-38`) and never falls back to anything weaker: an
unopenable message stays unopened. Envelope version is checked and an unknown version
is refused rather than guessed (`web/src/crypto/message.ts:72`,
`android/.../MessageCrypto.kt:102`). Call frames that do not open are **dropped, not
forwarded in the clear** (`web/src/voice/frameCrypto.worker.ts:120-123`,
`frame_crypto.cc:164`), and the worker reports whether a receiver's first frame ever
opened (`:115-119`) so a silently-unencrypted stream is detectable. The download
streamer refuses a server that answers from the wrong offset
(`web/src/crypto/streamDecrypt.ts:109-112`) and a file longer than declared
(`:130,:201`). There is no plaintext fallback path anywhere; I looked for one.

**Payload sanitisation.** Both clients sanitise the decrypted payload before use
(`web/src/crypto/message.ts:142-169`, `android/.../MessageCrypto.kt:175-198`), with
matching semantics including the "had content but none of it usable counts as
undecryptable" rule. This is a nice piece of defence: a key-holding member cannot
crash every other client with a wrongly-typed field.

**Server-side.** I read the key handlers and store end to end and found no way for
the server code *as written* to obtain a root key: `handleKeyGrantsPut` requires the
caller to be entitled and to actually hold the key, and correctly refuses to treat a
self-planted grant as proof of holding (`internal/api/key_handlers.go:92-126`, with
the reasoning spelled out at `:108-115`). Epoch creation is racy-but-correct, using a
compare-and-set on `max(epoch) + 1` inside a transaction
(`internal/store/keys.go:41-52`) with a pending-rotation guard so a thundering herd of
devices produces one epoch (`:33-40`). `Needs` excludes conversations the user has
left (`internal/store/keys.go:304-307`) and excludes self-wrapped grants from
counting as holding (`:262`). The CRITICAL finding is not that this code is wrong —
it is that clients have no way to tell whether the code is the code that is running.

**Storage, what is right.** Android seals its vault with an AndroidKeystore AES key
with `setRandomizedEncryptionRequired(true)` (`android/.../data/SecureStore.kt:152-161`),
which is strictly better than the browser, and the file says so honestly
(`:22-27`). The service worker has no `fetch` handler by design (`web/src/sw.ts:5-11`),
so nothing is cached there. `mediaCache` is memory-only with object URLs revoked on
eviction (`web/src/lib/mediaCache.ts:24,37,122`). The download service worker holds
the file key and token only in memory, with a 60-second TTL, deleted the moment the
stream starts (`web/src/download-sw.ts:51,64,150`), and responds `no-store` (`:208`).
Crash reports carry no key material, no token and no message text, and deliberately
send `location.pathname` rather than `location.hash`, so invite-link root keys do not
leak into them (`web/src/lib/crashReport.ts:44-53`).

**What I did not cover.** I did not review the gateway's authentication or session
handling beyond where it touches keys; I did not review the SFU signalling proxy
(`internal/api/sfu_handlers.go`) for anything but its relationship to frame keys; I
did not review MFA/TOTP beyond noting that the secret is server-readable; I did not
audit `internal/perms` or the permission model that decides who is "entitled", which
the whole grant system depends on; I did not attempt any dynamic testing against a
running instance; and I did not review the iOS/PWA-specific code paths. The
`@noble/curves` and `@noble/hashes` dependencies and the `argon2kt` / BouncyCastle
Android dependencies were treated as trusted and not audited, though I did verify
their *outputs* agree across platforms.
