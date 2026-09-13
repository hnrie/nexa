import { api } from "./client";
import { one, recordRequests, recordUploads } from "./testing";
import { avatarUrl, mediaSize, bannerUrl, emojiUrl, iconUrl, stickerUrl, users } from "./users";

beforeEach(() => {
  api.baseUrl = "";
});

describe("users", () => {
  it("reads the current user", async () => {
    const calls = recordRequests();
    await users.me();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/@me" });
  });

  it("patches the current user", async () => {
    const calls = recordRequests();
    await users.patchMe({ display_name: "Mara", about_me: null });
    expect(one(calls)).toMatchObject({
      method: "PATCH",
      path: "/users/@me",
      body: { display_name: "Mara", about_me: null },
    });
  });

  it("deletes the account with the auth key", async () => {
    const calls = recordRequests();
    await users.deleteMe("QUFB");
    expect(one(calls)).toMatchObject({
      method: "POST",
      path: "/users/@me/delete",
      body: { auth_key: "QUFB" },
    });
  });

  it("reads another user", async () => {
    const calls = recordRequests();
    await users.get("42");
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/42" });
  });

  it("reads a profile", async () => {
    const calls = recordRequests();
    await users.profile("42");
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/42/profile" });
  });

  it("searches with q in the query", async () => {
    const calls = recordRequests([]);
    await users.search("mar");
    const c = one(calls);
    expect(c.path).toBe("/users/search");
    expect(c.opts?.query).toEqual({ q: "mar" });
  });

  it("reads the settings blob", async () => {
    const calls = recordRequests({ blob: "QUFB", version: 3 });
    await expect(users.getSettings()).resolves.toEqual({ blob: "QUFB", version: 3 });
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/@me/settings" });
  });

  it("turns an empty settings response into null", async () => {
    recordRequests(undefined);
    await expect(users.getSettings()).resolves.toBeNull();
  });

  it("writes the settings blob with its version", async () => {
    const calls = recordRequests({ version: 4 });
    await users.putSettings("QUFB", 3);
    expect(one(calls)).toMatchObject({
      method: "PUT",
      path: "/users/@me/settings",
      body: { blob: "QUFB", version: 3 },
    });
  });

  it("reads the key bundle", async () => {
    const calls = recordRequests();
    await users.myKeys();
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/@me/keys" });
  });

  it("reads another user's public key", async () => {
    const calls = recordRequests();
    await users.publicKey("42");
    expect(one(calls)).toMatchObject({ method: "GET", path: "/users/42/public-key" });
  });

  it("PUTs an avatar with the file's own content type", async () => {
    const uploads = recordUploads();
    const file = new Blob([new Uint8Array([1, 2])], { type: "image/png" });
    await users.uploadAvatar(file);
    const c = one(uploads);
    expect(c.path).toBe("/users/@me/avatar");
    expect(c.opts?.method).toBe("PUT");
    expect(c.opts?.headers).toEqual({ "Content-Type": "image/png" });
  });

  it("passes the avatar progress callback through", async () => {
    const uploads = recordUploads();
    const onProgress = (): void => undefined;
    await users.uploadAvatar(new Blob([], { type: "image/webp" }), onProgress);
    expect(one(uploads).opts?.onProgress).toBe(onProgress);
  });

  it("deletes the avatar", async () => {
    const calls = recordRequests();
    await users.deleteAvatar();
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/users/@me/avatar" });
  });

  it("PUTs a banner", async () => {
    const uploads = recordUploads();
    await users.uploadBanner(new Blob([], { type: "image/jpeg" }));
    const c = one(uploads);
    expect(c.path).toBe("/users/@me/banner");
    expect(c.opts?.method).toBe("PUT");
    expect(c.opts?.headers).toEqual({ "Content-Type": "image/jpeg" });
  });

  it("deletes the banner", async () => {
    const calls = recordRequests();
    await users.deleteBanner();
    expect(one(calls)).toMatchObject({ method: "DELETE", path: "/users/@me/banner" });
  });
});

describe("media urls", () => {
  it("builds media paths per kind", () => {
    expect(avatarUrl("7")).toBe("/media/avatar/7");
    expect(bannerUrl("7")).toBe("/media/banner/7");
    expect(iconUrl("7")).toBe("/media/icon/7");
    expect(emojiUrl("7", false)).toBe("/media/emoji/7");
    expect(emojiUrl("7", true)).toBe("/media/emoji/7");
    expect(stickerUrl("7")).toBe("/media/sticker/7");
  });

  it("returns null when there is no id", () => {
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(null, 32)).toBeNull();
    expect(bannerUrl(null)).toBeNull();
    expect(iconUrl(null)).toBeNull();
  });

  it("asks for a copy the size a picture is drawn, sharp on dense screens", () => {
    const dpr = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { value: { devicePixelRatio: 2 }, configurable: true });
    try {
      expect(avatarUrl("7", 32)).toBe("/media/avatar/7?size=64");
      // rounded up to the powers of two the server keeps
      expect(iconUrl("7", 48)).toBe("/media/icon/7?size=128");
      expect(emojiUrl("7", true, 24)).toBe("/media/emoji/7?size=64");
      expect(stickerUrl("7", 160)).toBe("/media/sticker/7?size=512");
      // never past the largest copy
      expect(bannerUrl("7", 600)).toBe("/media/banner/7?size=1024");
    } finally {
      if (dpr) Object.defineProperty(globalThis, "window", dpr);
      else delete (globalThis as { window?: unknown }).window;
    }
    expect(mediaSize(10)).toBe(16);
  });

  it("honours a cross-origin baseUrl", () => {
    api.baseUrl = "https://chat.example";
    expect(avatarUrl("7")).toBe("https://chat.example/media/avatar/7");
  });
});
