# koffi's Windows native module

`win32_x64/koffi.node` is the prebuilt module from `@koromix/koffi-win32-x64`
3.2.1, the version of `koffi` in package.json. The Windows build ships it in
`resources/koffi/win32_x64`, where koffi looks for it inside a packaged app
(`process.resourcesPath`). `src/main/appAudio.ts` uses it to find the program
behind a shared window, so the share can carry just that program's sound.

To refresh it after changing koffi's version (from a Mac, no compiler needed):

```
npm install --no-save --os=win32 --cpu=x64 --ignore-scripts @koromix/koffi-win32-x64@<version>
cp node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node resources/koffi/win32_x64/
```

MIT licensed; see LICENSE.txt.
