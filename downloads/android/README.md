# Nexa for Android downloads

The Android app's release APKs and `manifest.json`, which lists them. chatd serves this folder
(`ANDROID_DIR`, see `internal/api/android_handlers.go`): the download page, the banner on Android
phones and the app's own update check read `/api/v1/android/latest`, and phones download from
`/android/<name>`. With no manifest here, the site simply offers no Android download.

Nothing here is written by hand. To release a new version, raise `versionCode` and `versionName`
in `android/app/build.gradle.kts`, then:

```
python3 tools/android_release.py --notes "What changed"
git add downloads/android && git commit -m "Nexa for Android 1.0.1" && git push
```

and run `git pull` on the server. chatd reads the folder on every request, so the new version is
offered at once. The file names stay the same from version to version; the manifest's `sha256` is
what tells them apart.

The builds are signed with the key `android/keystore.properties` names. Keep that key: Android only
installs an update signed with the same one, and the script refuses a build signed with any other.
