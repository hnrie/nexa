// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { admin } from "@/api/admin";
import type { InstanceInfo } from "@/api/types";
import HomePage from "./HomePage";

/** A browser that asks for less movement, or not. */
function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
}

async function open() {
  const view = render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  // the ciphertext is made asynchronously, with WebCrypto
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return view;
}

beforeEach(() => {
  // jsdom has no media playback and no scrolling; the page only needs the calls to exist
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HomePage", () => {
  it("says what Nexa is in chapters, and compares it to nothing", async () => {
    motion(false);
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Private Chat with All the Fun Left In");
    const chapters = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(chapters).toEqual(["Why Nexa", "Servers for Your People", "Voice and Video", "Write Together", "Make It Yours", "Private by Design", "Quick on Every Device", "What You Can Count On", "Start Chatting"]);
    expect(document.querySelector("table")).toBeNull();
    expect(document.body.textContent).not.toMatch(/discord/i);
    expect(document.body.textContent).not.toContain("—");
    // the load size it names is the one tools/app_size.py holds the build to
    expect(document.body.textContent).toContain("under 365 kB");
  });

  it("leads with open source and contribution links, and names the server's own upload limit", async () => {
    motion(false);
    vi.spyOn(admin, "instance").mockResolvedValue({ max_upload_bytes: 15 * 1024 ** 3 } as InstanceInfo);
    await open();
    const promises = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(promises.slice(0, 5)).toEqual(["Open Source", "Nobody Reading Along", "Nothing to Hand Over", "Nothing to Pay For", "Nothing Left Out"]);
    expect(screen.getByRole("heading", { level: 4, name: "Contributions Welcome" })).toBeTruthy();
    const hero = document.getElementById("home-top")!;
    expect(within(hero).getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe("https://github.com/terrydavisthe2nd/nexa");
    for (const link of screen.getAllByRole("link", { name: /GitHub/ })) {
      expect(link.getAttribute("href")).toBe("https://github.com/terrydavisthe2nd/nexa");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    expect(screen.getByRole("heading", { level: 4, name: "Files up to 15 GB" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Notes You Write Together" })).toBeTruthy();
  });

  it("says only that files can be big when the server cannot be asked", async () => {
    motion(false);
    vi.spyOn(admin, "instance").mockRejectedValue(new Error("offline"));
    await open();
    expect(screen.getByRole("heading", { level: 4, name: "Big Files" })).toBeTruthy();
  });

  it("embeds the isolated app and preserves it when expanded", async () => {
    motion(false);
    await open();
    const frame = screen.getByTitle("Explore Nexa");
    expect(frame.getAttribute("src")).toBe("/demo.html?locale=en");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(frame.getAttribute("allow")).toContain("microphone 'none'");
    fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
    expect(screen.getByRole("dialog", { name: "Explore Nexa" })).toBeTruthy();
    expect(screen.getByTitle("Explore Nexa")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Exit Full Screen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTitle("Explore Nexa")).toBe(frame);
    fireEvent.click(screen.getByRole("button", { name: "Reset Demo" }));
    expect(screen.getByTitle("Explore Nexa")).not.toBe(frame);
  });

  it("plays the loops, which can be paused", async () => {
    motion(false);
    await open();
    const videos = document.querySelectorAll("video");
    expect(videos).toHaveLength(4);
    expect([...videos].map((v) => v.getAttribute("aria-label"))).toEqual([
      "Two people in a Nexa voice call, speaking",
      "Two people writing in the same Nexa note at once, each with their own cursor",
      "A Nexa server shown in one colour theme after another",
      "Moving through six channels in a Nexa server, one after another",
    ]);
    // the speed and notes loops start on the frame their stills were taken from
    expect(videos[1]!.querySelector("source")!.getAttribute("src")).toBe("/home/notes.webm#t=3");
    expect(videos[3]!.querySelector("source")!.getAttribute("src")).toBe("/home/speed.webm#t=2");
    const pause = screen.getAllByRole("button", { name: "Pause" })[0]!;
    fireEvent.click(pause);
    expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(1);
  });

  it("shows stills rather than loops to anyone who asked for less movement", async () => {
    motion(true);
    await open();
    expect(document.querySelectorAll("video")).toHaveLength(0);
    const stills = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(stills).toEqual(expect.arrayContaining(["/home/call-loop.png", "/home/notes.png", "/home/themes.png", "/home/speed.png"]));
  });

  it("scrolls the document while it is open, takes over from the server's first paint, and gives both back", async () => {
    motion(false);
    const paint = document.createElement("style");
    paint.id = "front-paint";
    document.head.appendChild(paint);
    const view = await open();
    expect(document.documentElement.dataset["home"]).toBe("");
    expect(document.getElementById("front-paint")).toBeNull();
    view.unmount();
    expect("home" in document.documentElement.dataset).toBe(false);
  });
});
