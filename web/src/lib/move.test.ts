// @vitest-environment jsdom
import { b64 } from "@/crypto/bytes";
import { keystore } from "@/crypto/keystore";
import { handoffIn, movedLink, movedTo, moveTo, olderThan, openMoving, sealMoving, stayForOldDesktop, takeHandoff, type Moving } from "./move";

function meta(content: string | null) {
  document.head.querySelectorAll('meta[name="nexa-moved-to"]').forEach((m) => m.remove());
  if (content === null) return;
  const m = document.createElement("meta");
  m.name = "nexa-moved-to";
  m.content = content;
  document.head.appendChild(m);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  meta(null);
  localStorage.clear();
  delete (window as Window & { evilionDesktop?: unknown }).evilionDesktop;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("moving to Nexa's new address", () => {
  it("knows it was moved only from the marker the server puts on an old address's pages", () => {
    expect(movedTo()).toBeNull();
    meta("https://nexa.example");
    expect(movedTo()).toBe("https://nexa.example");
    // nowhere to go: the same address, or not an address
    meta(location.origin);
    expect(movedTo()).toBeNull();
    meta("javascript:alert(1)");
    expect(movedTo()).toBeNull();
  });

  it("leaves a desktop app from before the move where it is", () => {
    expect(olderThan("1.1.0", "1.2.0")).toBe(true);
    expect(olderThan("1.2.0", "1.2.0")).toBe(false);
    expect(olderThan("1.10.0", "1.2.0")).toBe(false);
    expect(stayForOldDesktop()).toBe(false);
    (window as Window & { evilionDesktop?: unknown }).evilionDesktop = { version: "1.1.0", platform: "linux" };
    expect(stayForOldDesktop()).toBe(true);
    (window as Window & { evilionDesktop?: unknown }).evilionDesktop = { version: "1.2.0", platform: "linux" };
    expect(stayForOldDesktop()).toBe(false);
  });

  it("seals what moves so only the key in the link opens it", async () => {
    const moving: Moving = { v: 1, token: "tok", userId: "42", identity: { pub: "cHVi", priv: "cHJpdg==" }, local: { "ec:locale": "de" } };
    const { sealed, key } = await sealMoving(moving);
    expect(sealed).not.toContain("tok");
    expect(await openMoving(sealed, key)).toEqual(moving);
    const other = crypto.getRandomValues(new Uint8Array(32));
    expect(await openMoving(sealed, other)).toBeNull();
  });

  it("carries the page, its own # part and the words to take the sign-in by", () => {
    expect(movedLink("https://n.example", "/channels/@me", "", "")).toBe("https://n.example/channels/@me");
    expect(movedLink("https://n.example", "/invite/abc", "#k=KEY", "")).toBe("https://n.example/invite/abc#k=KEY");
    expect(movedLink("https://n.example", "/channels/@me", "", "id.key")).toBe("https://n.example/channels/@me#nexa-handoff=id.key");
    const link = movedLink("https://n.example", "/note/t", "#k=KEY", "id_1.k-2");
    expect(link).toBe("https://n.example/note/t#k=KEY&nexa-handoff=id_1.k-2");
    // and the page there takes them back out, leaving its own
    expect(handoffIn(new URL(link).hash)).toEqual({ id: "id_1", key: "k-2", rest: "#k=KEY" });
    expect(handoffIn("#nexa-handoff=a.b")).toEqual({ id: "a", key: "b", rest: "" });
    expect(handoffIn("#k=KEY")).toBeNull();
  });

  it("leaves the session, the keys and this device's preferences, and goes on signed in", async () => {
    localStorage.setItem("ec.token", "tok");
    localStorage.setItem("ec:locale", "de");
    localStorage.setItem("crashReloads", "3");
    localStorage.setItem("other", "x");
    localStorage.setItem("nexa.terms-accepted.42", "2026-10-01.1");
    vi.spyOn(keystore, "loadIdentity").mockResolvedValue({ publicKey: new Uint8Array([1, 2]), privateKey: new Uint8Array([3, 4]) });
    let left = "";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/users/@me") return json(200, { id: "42" });
      if (url === "/api/v1/handoffs") {
        expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
        left = (JSON.parse(String(init?.body)) as { sealed: string }).sealed;
        return json(201, { id: "copy1" });
      }
      return json(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    let went = "";
    history.replaceState(null, "", "/channels/@me?x=1#k=KEY");
    await moveTo("https://n.example", (url) => (went = url));
    const found = handoffIn(new URL(went).hash)!;
    expect(went.startsWith("https://n.example/channels/@me?x=1#k=KEY&nexa-handoff=copy1.")).toBe(true);
    const key = b64.dec(found.key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((found.key.length + 3) % 4));
    const moving = await openMoving(left, key);
    expect(moving?.token).toBe("tok");
    expect(moving?.userId).toBe("42");
    expect(moving?.identity).toEqual({ pub: b64.enc(new Uint8Array([1, 2])), priv: b64.enc(new Uint8Array([3, 4])) });
    // this device's preferences go along, the Terms agreed to among them; crash counters stay
    expect(moving?.local).toEqual({ "ec.token": "tok", "ec:locale": "de", "nexa.terms-accepted.42": "2026-10-01.1", other: "x" });
  });

  it("goes on signed out when there is no sign-in to move, or it cannot be left", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, {})));
    let went = "";
    history.replaceState(null, "", "/download");
    await moveTo("https://n.example", (url) => (went = url));
    expect(went).toBe("https://n.example/download");
    localStorage.setItem("ec.token", "tok");
    await moveTo("https://n.example", (url) => (went = url));
    expect(went).toBe("https://n.example/download");
  });

  it("takes a moved sign-in once, before anything reads it, and takes the words out of the address", async () => {
    const moving: Moving = { v: 1, token: "tok", userId: "42", identity: { pub: b64.enc(new Uint8Array([1])), priv: b64.enc(new Uint8Array([2])) }, local: { "ec:locale": "de", "ec.lock.42": "{}" } };
    const { sealed, key } = await sealMoving(moving);
    const words = `copy1.${b64.enc(key).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    const saved = vi.spyOn(keystore, "saveIdentity").mockResolvedValue();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/v1/handoffs/take");
      expect(JSON.parse(String(init?.body))).toEqual({ id: "copy1", from: document.referrer });
      return json(200, { sealed });
    });
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState(null, "", `/invite/abc#k=KEY&nexa-handoff=${words}`);
    await takeHandoff();
    expect(location.pathname + location.hash).toBe("/invite/abc#k=KEY");
    expect(localStorage.getItem("ec.token")).toBe("tok");
    expect(localStorage.getItem("ec:locale")).toBe("de");
    expect(localStorage.getItem("ec.lock.42")).toBe("{}");
    expect(saved).toHaveBeenCalledWith("42", { publicKey: new Uint8Array([1]), privateKey: new Uint8Array([2]) });

    // a device already signed in here keeps its own sign-in, and still loses the words
    fetchMock.mockClear();
    localStorage.setItem("ec.token", "mine");
    history.replaceState(null, "", `/channels/@me#nexa-handoff=${words}`);
    await takeHandoff();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
    expect(localStorage.getItem("ec.token")).toBe("mine");
  });

  it("stays signed out when the copy is gone or will not open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: { code: "handoff_gone" } })));
    history.replaceState(null, "", "/#nexa-handoff=copy1.AAAA");
    await takeHandoff();
    expect(localStorage.getItem("ec.token")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { sealed: "bm90IHNlYWxlZA==" })));
    history.replaceState(null, "", "/#nexa-handoff=copy1.AAAA");
    await takeHandoff();
    expect(localStorage.getItem("ec.token")).toBeNull();
  });
});
