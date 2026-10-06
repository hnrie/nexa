// @vitest-environment jsdom
import { movedLink, movedTo, moveTo, olderThan, stayForOldDesktop } from "./move";

function meta(content: string | null) {
  document.head.querySelectorAll('meta[name="nexa-moved-to"]').forEach((m) => m.remove());
  if (content === null) return;
  const m = document.createElement("meta");
  m.name = "nexa-moved-to";
  m.content = content;
  document.head.appendChild(m);
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

  it("carries the page, its query and its own # part, which may hold an invite's key", () => {
    expect(movedLink("https://n.example", "/channels/@me", "", "")).toBe("https://n.example/channels/@me");
    expect(movedLink("https://n.example", "/invite/abc", "", "#k=KEY")).toBe("https://n.example/invite/abc#k=KEY");
    expect(movedLink("https://n.example", "/download", "?os=mac", "#")).toBe("https://n.example/download?os=mac");
  });

  it("goes on to the same page without sending this device's sign-in anywhere", () => {
    localStorage.setItem("ec.token", "tok");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let went = "";
    history.replaceState(null, "", "/channels/@me?x=1#k=KEY");
    moveTo("https://n.example", (url) => (went = url));
    expect(went).toBe("https://n.example/channels/@me?x=1#k=KEY");
    expect(went).not.toContain("tok");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
