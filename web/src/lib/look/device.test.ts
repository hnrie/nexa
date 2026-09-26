// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cssKey, lookCache } from "./cache";
import { forgetLinks, loadLink, refreshLink, useCssLinks } from "./cssLinks";
import { FetchError, checkLink, fetchText } from "./fetchText";
import { cssOff, initSafeMode, lookActive, noteCrash, noteHealthy, pluginsOff, setLookActive, useSafeMode } from "./safeMode";
import { MAX_LINKS, linkName, sanitizeCustomCss, sanitizePlugins, sanitizeValues } from "./sanitize";
import { applyRememberedSheets, clearSheets, forgetSheets, rememberSheets, setSheets } from "./styles";

const HASH = "a".repeat(64);

describe("links", () => {
  it("are https only, and never carry a password", () => {
    expect(checkLink("https://example.com/theme.css")?.href).toBe("https://example.com/theme.css");
    for (const bad of ["http://example.com/x.css", "javascript:alert(1)", "data:text/css,a{}", "https://user:pw@example.com/x.css", "ftp://example.com/x", "not a link", ""]) expect(checkLink(bad), bad).toBeNull();
  });

  it("are named after their file", () => {
    expect(linkName("https://cdn.example/themes/midnight%20blue.css")).toBe("midnight blue.css");
    expect(linkName("https://example.com/")).toBe("example.com");
  });
});

describe("fetching a file from a link", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: string, init: ResponseInit = {}) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, init)));

  it("returns the text, fetched without credentials or a referrer", async () => {
    answer(".a{}", { headers: { "content-type": "text/css" } });
    expect(await fetchText("https://example.com/a.css")).toBe(".a{}");
    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("says what was wrong with what came back", async () => {
    const reason = async () => fetchText("https://example.com/a.css").then(() => null, (e: unknown) => (e as FetchError).reason);
    answer("<!doctype html><p>hi", { headers: { "content-type": "text/plain" } });
    expect(await reason()).toBe("html");
    answer("x", { headers: { "content-type": "text/html; charset=utf-8" } });
    expect(await reason()).toBe("html");
    answer("nope", { status: 404 });
    expect(await reason()).toBe("status");
    answer("   ");
    expect(await reason()).toBe("empty");
    answer("x".repeat(1024 * 1024 + 1));
    expect(await reason()).toBe("size");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    expect(await reason()).toBe("network");
    await expect(fetchText("http://example.com/a.css")).rejects.toMatchObject({ reason: "https" });
  });
});

describe("the look settings from another device", () => {
  it("keep only links that can be loaded, once each, up to the limit", () => {
    const links = [
      { id: "aaaaaaaaaa", url: "https://a.example/a.css", enabled: false, addedAt: 1 },
      { id: "aaaaaaaaaa", url: "https://a.example/b.css", enabled: true, addedAt: 1 },
      { id: "bbbbbbbbbb", url: "http://insecure.example/a.css", enabled: true, addedAt: 1 },
      { id: "short", url: "https://a.example/c.css" },
      ...Array.from({ length: 30 }, (_, i) => ({ id: `c${String(i).padStart(9, "0")}`, url: `https://a.example/${i}.css` })),
    ];
    const cc = sanitizeCustomCss({ snippet: "t1:a{}", links });
    expect(cc.links[0]).toEqual({ id: "aaaaaaaaaa", url: "https://a.example/a.css", enabled: false, addedAt: 1 });
    expect(cc.links.length).toBe(MAX_LINKS);
    expect(cc.links.some((l) => l.url.startsWith("http:"))).toBe(false);
    expect(cc.snippetOn).toBe(true);
    expect(sanitizeCustomCss(null)).toEqual({ snippet: "", snippetOn: true, links: [] });
  });

  it("keep only plugins that are pinned to a hash and come from somewhere real", () => {
    const list = sanitizePlugins([
      { id: "pppppppppp", source: "url", url: "https://p.example/p.js", hash: HASH, enabled: true, settings: { a: 1, b: { nested: true }, c: "x" }, meta: { name: "P", version: "1" } },
      { id: "qqqqqqqqqq", source: "url", url: "http://p.example/p.js", hash: HASH, enabled: true },
      { id: "rrrrrrrrrr", source: "code", code: null, hash: HASH, enabled: true },
      { id: "ssssssssss", source: "code", code: "t1:x", hash: "not-a-hash", enabled: true },
      { id: "tttttttttt", source: "code", code: "t1:x", hash: HASH },
    ]);
    expect(list.map((p) => p.id)).toEqual(["pppppppppp", "tttttttttt"]);
    expect(list[0]!.settings).toEqual({ a: 1, c: "x" });
    expect(list[0]!.meta).toEqual({ name: "P", description: "", version: "1", author: "" });
    // not said to be on is off
    expect(list[1]!.enabled).toBe(false);
  });

  it("keep a plugin's setting values plain and small", () => {
    expect(sanitizeValues({ ok: true, n: 2, s: "x", o: {}, a: [1] })).toEqual({ ok: true, n: 2, s: "x" });
    expect(sanitizeValues({ big: "x".repeat(2000), more: "y".repeat(2000), evenMore: "z".repeat(2000), andMore: "w".repeat(2000), last: "v".repeat(2000) })).toEqual({});
  });
});

describe("the person's CSS in the page", () => {
  beforeEach(() => {
    document.getElementById("nexa-custom-css")?.remove();
    localStorage.clear();
    useSafeMode.setState({ mode: null });
  });
  const sheets = () => [...document.querySelectorAll("#nexa-custom-css style")].map((s) => `${(s.parentElement as HTMLElement).dataset["group"]}:${s.textContent}`);

  it("comes after everything the app loads, with the person's own snippet last", () => {
    document.head.append(Object.assign(document.createElement("style"), { textContent: ".app{}" }));
    setSheets("snippet", [{ id: "snippet", css: ".mine{}" }]);
    setSheets("links", [{ id: "a", css: ".a{}" }, { id: "b", css: ".b{}" }]);
    setSheets("plugins", [{ id: "p", css: ".p{}" }]);
    expect(sheets()).toEqual(["plugins:.p{}", "links:.a{}", "links:.b{}", "snippet:.mine{}"]);
    // later than any stylesheet in the head, which is where the app's own are
    const all = [...document.querySelectorAll("style")];
    expect(all.indexOf(document.querySelector("#nexa-custom-css style")!)).toBeGreaterThan(all.findIndex((s) => s.textContent === ".app{}"));
  });

  it("changes only what changed, in the order asked for", () => {
    setSheets("links", [{ id: "a", css: ".a{}" }, { id: "b", css: ".b{}" }]);
    const a = document.querySelector('[data-sheet="a"]');
    setSheets("links", [{ id: "b", css: ".b2{}" }, { id: "a", css: ".a{}" }]);
    expect(sheets()).toEqual(["links:.b2{}", "links:.a{}"]);
    expect(document.querySelector('[data-sheet="a"]')).toBe(a);
    setSheets("links", []);
    expect(sheets()).toEqual([]);
  });

  it("is remembered for the first frame, and not drawn in safe mode", () => {
    rememberSheets({ links: [{ id: "a", css: ".a{}" }], snippet: [{ id: "snippet", css: ".mine{}" }] });
    clearSheets();
    applyRememberedSheets();
    expect(sheets()).toEqual(["links:.a{}", "snippet:.mine{}"]);
    clearSheets();
    useSafeMode.setState({ mode: "manual" });
    applyRememberedSheets();
    expect(sheets()).toEqual([]);
    forgetSheets();
    useSafeMode.setState({ mode: null });
    applyRememberedSheets();
    expect(sheets()).toEqual([]);
  });
});

describe("safe mode", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, "", "/channels/@me");
  });

  it("starts from ?safe, takes it off the address, and lasts for the tab", () => {
    history.replaceState(null, "", "/channels/@me?safe&x=1#top");
    expect(initSafeMode()).toBe("manual");
    expect(location.search).toBe("?x=1");
    expect(location.hash).toBe("#top");
    expect(cssOff() && pluginsOff()).toBe(true);
    // a reload in the same tab stays safe
    expect(initSafeMode()).toBe("manual");
  });

  it("turns plugins off after crashes while they ran, but not custom CSS", () => {
    noteCrash();
    expect(initSafeMode()).toBeNull();
    setLookActive(true);
    noteCrash();
    noteCrash();
    expect(initSafeMode()).toBe("crashes");
    expect(pluginsOff()).toBe(true);
    expect(cssOff()).toBe(false);
  });

  it("forgives crashes once the app has stayed up", () => {
    setLookActive(true);
    noteCrash();
    noteCrash();
    noteHealthy();
    expect(initSafeMode()).toBeNull();
    expect(lookActive()).toBe(true);
  });
});

describe("a stylesheet from a link, on this device", () => {
  beforeEach(async () => {
    await lookCache.clear();
    forgetLinks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is read from this device's copy first, so it is there with the site down", async () => {
    await lookCache.put(cssKey("https://t.example/a.css"), { text: ".kept{}", fetchedAt: Date.now() });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    expect(await loadLink("https://t.example/a.css")).toEqual({ stale: false });
    expect(useCssLinks.getState().texts["https://t.example/a.css"]).toBe(".kept{}");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the copy it has when a refresh fails, and says why", async () => {
    await lookCache.put(cssKey("https://t.example/a.css"), { text: ".kept{}", fetchedAt: 0 });
    expect((await loadLink("https://t.example/a.css")).stale).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    await refreshLink("https://t.example/a.css");
    const state = useCssLinks.getState();
    expect(state.texts["https://t.example/a.css"]).toBe(".kept{}");
    expect(state.byUrl["https://t.example/a.css"]).toMatchObject({ status: "ready", error: "status", errorStatus: 404 });
  });

  it("is fetched and kept when this device has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(".new{}", { headers: { "content-type": "text/css" } })));
    await loadLink("https://t.example/b.css");
    expect(useCssLinks.getState().texts["https://t.example/b.css"]).toBe(".new{}");
    expect((await lookCache.get(cssKey("https://t.example/b.css")))?.text).toBe(".new{}");
  });
});
