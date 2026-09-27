# Unfinished work

Requests from the owner that are not built yet, written so a new session with
no memory can do them exactly. Follow `CLAUDE.md` (UI text rules, all eleven
translations, never `npm run build` / `make web` / `make server` /
`make build`, migrations in both SQLite and Postgres folders, check UI at
desktop and phone sizes). Keep every commit deployable. When one is done,
remove it from this file in the same commit, and delete the file once empty.

## Server-side cropping for avatar-like images (keep GIFs animated)

The owner, word for word:

> when we crop images on any part of the site, we should always crop them
> ourselves on the server too, we don't want people putting insane
> resolutions on images in those fields, stickers, uploaded media in chats are
> perfectly fine, i mean stuff like what i described.

> don't make cropping ruin animated gifs and stuff, that isn't cool.

What to build:

- Applies to every image the app crops before upload: user avatars and
  banners, server icons and banners, group chat icons, channel icons if they
  are images, webhook pictures, and any other field that goes through
  `web/src/components/common/ImageCropModal.tsx`. **Not** stickers, emoji
  packs or chat attachments.
- The server must not trust the browser's crop. On upload (these go through
  `media.PutPublic` in `internal/media/store.go`, with per-kind limits in
  `limitsFor` in `internal/api/media_handlers.go`, and `webhookAvatar` in
  `internal/api/webhook_handlers.go`), decode the image, centre-crop it to the
  field's aspect ratio (1:1 for avatars and icons; the banner ratio the crop
  modal uses for banners), and scale it down to that field's maximum output
  size (match what the crop modal produces, for example 512 or 1024 square
  for avatars). Images already within the size and ratio are stored as they
  are (no needless re-encode).
- Animated GIFs must stay animated: decode every frame (`image/gif`
  `DecodeAll`), crop and scale each frame with the same geometry (respecting
  frame offsets and disposal: composite onto a full canvas first, then crop
  and scale, then re-encode with the original delays, disposal and loop
  count, using `gif.EncodeAll`; quantise with the frame's palette or
  Floyd-Steinberg). Keep transparency.
- Animated WebP and APNG: Go has no encoder for them in the standard library.
  Keep them animated: store them unchanged when they are within the field's
  limits, and refuse them with a clear error when they are larger (the client
  crop already produces sizes within limits).
- Static PNG, JPEG and WebP: re-encode as PNG (with alpha) or JPEG (quality
  about 90) only when cropping or scaling was needed.
- Media metadata is already stripped on upload (`internal/media/scrub.go`);
  keep that running first.
- Tests: Go tests per format (oversized static image cropped and scaled to the
  field's size and ratio, animated GIF keeps every frame, delay and loop count
  after scaling, an in-limits image stored byte for byte, animated WebP within
  limits kept and oversized refused), and a check through the avatar upload
  route.
