# Android release signing

Debug builds need no release key. Release builds use the local
`android/signing/release.properties` and the keystore it names. Both are ignored by
Git. Copy `release.properties.example` to `release.properties` and fill it in on
the machine that builds releases. `storeFile` is relative to `android/`, or can
be an absolute path to a private keystore outside the checkout.

For an existing installation, restore its original keystore and properties from
a private backup. **Never generate a replacement key for an existing app:**
Android updates must be signed with the same key. Keep encrypted backups of the
keystore and its passwords separately from the source repository. Restrict the
local files to their owner (`chmod 600`).

For a new, independent distribution, generate your own key with your JDK's
`keytool`, choose your own application ID, and keep that key private. The Nexa
production signing key is not distributed with the source.
