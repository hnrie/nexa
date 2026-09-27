# Nexa bot platform: cryptography

The bot platform uses design 1 of [design.md](design.md) §4.2: the server holds a bot's
identity and acts for the bot. It needs to do exactly what a person's browser does, so
`internal/e2ee` repeats the web client's cryptography (`web/src/crypto`) in Go, byte for byte.
This page describes the shared formats and the bot identity scheme, which is new and exists in
both languages. Nothing calls `internal/e2ee` yet; the bot runtime (P1) will.

## 1. Where things live

| Formats | TypeScript | Go (`internal/e2ee`) |
|---|---|---|
| identity keys, sealed boxes, grants | `keys.ts` | `keys.go` |
| conversation roots, channel keys, key ring | `conv.ts` | `conv.go` |
| message envelopes | `message.ts` | `message.go`, `payload.go`, `jsjson.go` |
| attachments (ECF1) | `file.ts`, `fileChunks.ts` | `file.go` |
| bot identity | `botIdentity.ts` | `botidentity.go` |

Every failure to open something matches `e2ee.ErrDecrypt` in Go (`errors.Is`), like
`DecryptError` in TypeScript. Callers should not tell a bad tag from a malformed blob.

## 2. The formats both sides share

**Identity.** An x25519 key pair. The private key is 32 random bytes, clamped when it is used.

**Sealed box** (`seal`/`open`, `Seal`/`Open`):
`ephemeral public key (32) | iv (12) | AES-256-GCM ciphertext and tag`. The key is
HKDF-SHA256(shared secret, no salt, info `"evilion-chat/seal/v1" | ephPub | recipientPub`, 32 bytes),
and the additional data is the ephemeral public key. x25519 masks the top bit of a public key and
reduces it modulo p, but the HKDF info and the AAD take the key's bytes as sent. A low-order key,
which makes the shared secret all zeros, is refused on both sides.

**Grant.** A conversation root key sealed to a member: `wrapGrant(recipientPub, root)`.

**Channel keys.** A conversation has one root per epoch. The message key of a channel is
HKDF-SHA256(root, no salt, info `"chan:" + channelId`, 32 bytes). A call's frame key uses info
`"voice:" + channelId`. The epoch only picks the root; it is bound into each message's AAD.
`KeyRing` holds roots by conversation and epoch. The Go one is safe for concurrent use, copies
roots in and out, and `Clear` overwrites them.

**Message envelope.** The server stores `{"v":1,"conv":…,"epoch":…,"iv":…,"ct":…}`, with `iv` and
`ct` in standard base64 with padding. `ct` is AES-256-GCM, under the channel key, of the UTF-8 JSON
payload, with AAD `conv|epoch|channelId|authorId` in UTF-8. The web client takes `conv` and
`epoch` from the message's `key_conv_id` and `key_epoch`, not from the envelope.

The payload is a JSON object: `t` (text), `att` (attachments), `sticker`, `embeds` (link
previews), `flags`, and members added over time. The web client keeps only members it knows, of
the right types, and refuses a payload that names content (`t`, `att`, `sticker`, `embeds`) but has
none of it in a usable form. Go's `DecryptMessage` refuses the same payloads, but its `Payload`
keeps every member as raw JSON in order, so unknown members survive a decrypt and re-encrypt and a
browser's payload marshals back to the same bytes. The typed getters (`Text`, `Attachments`,
`Sticker`, `Embeds`, `Flags`) read members with the web client's sanitizer rules. The setters write
members as `JSON.stringify` does (no escaping of `<`, `>`, `&`, U+2028 or U+2029, and JavaScript's
number format), so a payload built in Go is the bytes a browser would encrypt for the same object.

The poll feature adds a `poll` member and makes an unusable poll count as content. Go keeps `poll`
as a raw member but does not read it yet. A payload whose only content is an unusable poll opens in
Go, while the web client refuses it. Bot polls (P5) should add the getter and the rule.

**Attachments (ECF1).** `"ECF1" | base iv (8) | [u32be length | ciphertext]…`. Chunk `i` holds
plaintext bytes `[i·4 MiB, (i+1)·4 MiB)`, sealed under the file key with iv `base iv | u32be(i)` and
AAD `"file/v1"`. Every chunk but the last is full, and an empty file has one empty chunk. The
encrypted size is `12 + chunks·20 + size`. There is no end-of-file marker, so a file cut at a chunk
boundary still authenticates. Only the size recorded in the (authenticated) message catches that.
The web client checks it at download (`channels.downloadAttachment`, `streamDecrypt.ts`), and Go's
`DecryptFile` and `DecryptFileStream` take the size and want exactly the framing it implies.

## 3. Bot identity

The browser that creates a bot (in the Developer Portal) makes the bot's identity and its token.
It sends the server four things, and the server keeps only these:

| Stored | Value |
|---|---|
| `public_key` | the bot's x25519 public key (32 bytes) |
| `wrapped` | the private key wrapped under the token (61 bytes, below) |
| `escrow` | the identity sealed to the owner's identity key (142 bytes, below) |
| `token_hash` | SHA-256 of the token's characters (32 bytes) |

**Token.** 32 random bytes in URL-safe base64 without padding: 43 characters. A string has the
shape of a token when it matches `^[A-Za-z0-9_-]{43,256}$` (`isBotToken`, `ValidBotToken`). The
developer sees the token once. The server never stores it: it finds the bot by hashing the token
that arrives in `Authorization: Bot <token>`.

**Wrapping key.** `K = HKDF-SHA256(ikm = the token's ASCII bytes, salt = "nexa/bot-identity/v1",
info = "nexa/bot-identity/v1/wrap", 32 bytes)`. The token carries 256 random bits, so no password
stretching is needed.

**Wrapped identity.** `0x01 | iv (12) | AES-256-GCM(K, iv, private key, AAD = public key)`: 61
bytes. The first byte is the scheme version. Unwrapping checks the length and version, decrypts,
and checks that x25519(private key) is the stored public key.

**Escrow.** `seal(ownerPub, "nexa/bot-escrow/v1" | public key | private key)` with the ordinary
sealed box: 142 bytes. Opening it checks the label, the length, that the private key belongs to
the public key inside, and that this is the bot's registered public key. The label matters: a
grant is also a sealed box to the owner. Without it, a server could offer one of the owner's
grants as a bot's "escrow", the owner's browser would wrap that conversation root under a new
token, and the server would read the root the next time the bot connected.

**Flows.**
- Create: `createBotIdentity(ownerPub)` makes the identity and the token, wraps, seals the escrow
  and hashes the token.
- Run: the server hashes the presented token, finds the bot, and calls
  `UnwrapBotIdentity(wrapped, token, public_key)`. With the identity it opens the bot's grants into
  a `KeyRing` and decrypts and encrypts like a client. It keeps the unwrapped key only while the
  bot is active.
- Reset the token: `rewrapBotIdentity` opens the escrow in the owner's browser, makes a new token
  and wraps the same identity again. Grants the bot holds keep working. The escrow stays as it is.
- Transfer ownership: the old owner's browser opens the escrow and seals it to the new owner.

**Limits of the scheme.**
- A token reset keeps the key pair. If a token leaked and an old `wrapped` value survives
  somewhere (a backup, a copy of the database), the old token still opens that copy. After a
  leak, give the bot a new identity instead (new key pair, grants again, rotate what it could read).
- If the owner's identity key changes, the escrow cannot be opened any more. The bot then needs a
  new identity.
- While a bot runs, the server holds its identity and sees everything the bot reads or writes
  (design.md §4.2, "What the operator can read").
- Compared with the draft in design.md §4.2: the app id is not bound into the key or the AAD. The
  token is unique to the app, and the public key as AAD ties a wrapped blob to its identity. The
  version byte and the escrow label are new.

## 4. Test vectors

Each side runs its real functions with a deterministic random source and records every call's
output together with the random bytes it took. The other side replays those bytes, must produce
the same output byte for byte, and opens everything.

- `internal/e2ee/testdata/ts-vectors.json` is written by `web/src/crypto/vectors.test.ts` and
  checked by `go test ./internal/e2ee`. Regenerate it with
  `WRITE_VECTORS=1 npx vitest run src/crypto/vectors.test.ts` (in `web/`).
- `web/src/crypto/testdata/go-vectors.json` is written by `internal/e2ee/vectors_test.go` and
  checked by the same vitest. Regenerate it with `WRITE_VECTORS=1 go test ./internal/e2ee`.
- A normal run of either test regenerates its own file in memory and fails if the checked-in file
  differs, so a format change shows up as a failing test until both files are regenerated.

They cover identities (including private keys that only work once clamped), sealed boxes and
grants, boxes that must not open (low-order ephemeral keys sealed with the all-zero secret, a
flipped tag, cut boxes, another recipient), channel and voice keys for several epochs, message
envelopes (non-ASCII and control characters, empty text, attachments, a sticker, embeds, flags,
JavaScript number formats, wrong types, webhook-only fields, unknown members, and payloads both
sides refuse), files of 0, 1, 1000, 4 MiB and 4 MiB + 1000 bytes (large ones by SHA-256),
encrypted sizes, token shapes, wrapped identities under two tokens, an escrow, and a whole
create-then-reset run. Go's unit tests add tamper checks (every truncation and every flipped bit,
wrong keys and AAD, reordered and dropped chunks), and none of them may panic.

## 5. Where the Go side is deliberately stricter

- `DecryptFile` needs the plaintext size and the exact framing it implies. `decryptFile` in
  `file.ts` needs neither, but the web client checks the size before it decrypts.
- Keys are exactly 32 bytes. WebCrypto would also take a 16-byte AES key.
- `ParseEnvelope` wants a safe-integer epoch, since the epoch must fit an `int`.
