# Nexa for Android downloads

The Android app's release APKs and `manifest.json`, which lists them. chatd serves this folder
(`ANDROID_DIR`, see `internal/api/android_handlers.go`): the download page, the banner on Android
phones and the app's own update check read `/api/v1/android/latest`, and phones download from
`/android/<name>`. With no manifest here, the site simply offers no Android download.

Nothing here is written by hand, and only this README is kept in git: each server builds and
publishes its own. `make build` (so every deploy) runs

```
python3 tools/android_release.py --if-changed
```

which builds a release only when something the app is made from (`android/`, and the web files its
build copies in) changed since the one published here. It numbers the release after the published
one (versionCode one higher, the last number of versionName one higher) and publishes it here;
chatd reads the folder on every request, so the app's updater offers it to every phone at once.
`make publish-android` builds and publishes one whether or not anything changed.

The builds are signed with the key in `android/signing` (`release.jks`, its passwords in
`release.properties`), kept in git on purpose so it is never lost. Never replace it: Android only
installs an update signed with the same key. Builds signed with the key before it (up to 1.1.0)
cannot update to these; those phones uninstall the app and install it again.
