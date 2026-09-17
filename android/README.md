# Nexa for Android

A native app: Kotlin and Jetpack Compose, OkHttp for the API and the gateway,
libwebrtc for calls. It talks to the same `chatd` the web client does, does the
same end-to-end encryption, and shares no code with the web app — nothing here
is a web view except Cloudflare's captcha, which has to run on the site's own
page to be checked.

## What it does

Everything the web client does, shaped for a phone: servers, categories and
channels with the same permission model; direct and group messages; friends,
presence, custom status and profiles; Discord-flavoured markdown with mentions,
custom emoji, stickers, spoilers and timestamps; replies, edits, reactions,
pins and typing; encrypted attachments up to this instance's limit, uploaded in
resumable pieces; the emoji, GIF and sticker pickers; search over what this
device has decrypted; voice and video calls through Cloudflare's SFU with
end-to-end encrypted frames, screen sharing, and an incoming-call screen;
notifications from the socket the app keeps open, with no push service in the
middle; and the account screens — password, recovery key, two-factor,
devices — that the web client has.

## How the encryption works here

The same as everywhere else in this project, so a message written on a phone
opens in a browser and the other way round:

- **argon2id** stretches the password (`com.lambdapioneer.argon2kt`), and
  HKDF-SHA256 splits it into the key the server checks and the key that
  unwraps this account's identity.
- **x25519** sealed boxes carry conversation keys (BouncyCastle's RFC 7748
  arithmetic), **AES-256-GCM** seals messages, settings and files.
- The identity key and conversation keys sit in a file this app encrypts with a
  key from the **Android keystore**, which on most phones lives in hardware.
  The browser keeps the same material in IndexedDB in the clear.
- **Call frames** are sealed with the conversation's key before they reach
  Cloudflare, in the format `web/src/voice/frameCrypto.ts` describes. WebRTC on
  Android only offers that hook to native code, so `src/main/cpp` implements
  `webrtc::FrameEncryptorInterface` and `FrameDecryptorInterface` over a
  self-contained AES-256-GCM (the NDK ships no crypto library an app may link
  against). `CryptoTest` checks the rest against ciphertext the web client
  produced; the frame format was checked against the web client's own
  `sealFrame`/`openFrame` in both directions.

## Building

Needs a JDK 17 or newer, the Android SDK (platform 37, build-tools, NDK 29 and
CMake for the frame crypto) and Gradle 9.

```
cd android
JAVA_HOME=… ANDROID_HOME=… gradle :app:assembleDebug        # a debug build
JAVA_HOME=… ANDROID_HOME=… gradle :app:testDebugUnitTest    # the tests
JAVA_HOME=… ANDROID_HOME=… gradle :app:assembleRelease      # the signed app
```

or `make android`, `make test-android` and `make publish-android` from the
repository root.

Release builds are signed with `release.jks`, whose passwords live in
`keystore.properties`. **Keep both.** An APK signed with a different key cannot
update one that is already installed; neither file is in git.

## Where things are

```
app/src/main/java/xyz/evilion/chat/
├── crypto/     argon2id, HKDF, x25519 sealed boxes, message and file encryption
├── net/        the wire types, the HTTP client, every endpoint, the gateway socket
├── data/       session, keys, messages, settings, permissions, app state
├── media/      attachment upload and download, the image loader
├── voice/      the WebRTC engine, the SFU transport, the call itself
├── ui/         Compose: auth, the shell, chat, pickers, settings, calls, sheets
├── service/    the foreground services for the socket and for calls
└── notify/     notifications
app/src/main/cpp/    the call frame format and AES-256-GCM, as a JNI library
```
