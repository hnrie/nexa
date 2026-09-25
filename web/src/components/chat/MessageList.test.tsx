// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@/api/types";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { MessageList } from "./MessageList";

// The list only ever asks a row where it is and what its id is, so a stand-in
// keeps these tests about scrolling rather than about markdown and avatars.
vi.mock("./MessageItem", () => ({
  MessageItem: ({ msg }: { msg: DecryptedMessage }) => <div data-id={msg.id} data-testid="row" />,
}));

const CHANNEL = "700";
const ME = "1";
const THEM = "2";

const channel: Channel = {
  id: CHANNEL,
  server_id: null,
  type: "dm",
  name: "",
  topic: "",
  position: 0,
  parent_id: null,
  nsfw: false,
  slowmode_seconds: 0,
  user_limit: 0,
  owner_id: null,
  icon_id: null,
  last_message_id: null,
  created_at: 0,
  recipient_ids: [ME, THEM],
  key_conv_id: CHANNEL,
};

function msg(id: string, author = THEM): DecryptedMessage {
  return {
    id,
    channel_id: CHANNEL,
    author_id: author,
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: Number(id),
    payload: { t: `m${id}` },
  };
}

// --- a fake layout ---------------------------------------------------------
// jsdom measures nothing: every box is zero by zero and scrollTop never moves.
// Anchoring is entirely about measurements, so one is supplied here — a box of
// a fixed height, rows of a fixed height each, and the same bottom pinning
// `.inner`'s `justify-content: flex-end` gives a list shorter than its box.

const BOX = 400;
const ROW = 40;
/** The spacer or spinner the list keeps above its first row. */
const HEAD = 24;

/** Rows taller than the usual, by id: a picture that has just finished loading. */
const heights = new Map<string, number>();

let scroller: HTMLElement;
let scrollTop = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

const rows = (): HTMLElement[] => [...scroller.querySelectorAll<HTMLElement>("[data-id]")];
const heightOf = (row: HTMLElement): number => heights.get(row.dataset.id!) ?? ROW;
const content = (): number => rows().reduce((h, r) => h + heightOf(r), HEAD);
/** A list shorter than its box sits at the bottom of it, not the top. */
const pinned = (): number => Math.max(0, BOX - content());
const maxScroll = (): number => Math.max(0, content() - BOX);

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function measure(): void {
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => BOX });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => Math.max(BOX, content()) });
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(Math.round(v), maxScroll()));
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this === scroller) return rect(0, BOX);
    let y = pinned() + HEAD;
    for (const row of rows()) {
      if (row === this) return rect(y - scrollTop, heightOf(row));
      y += heightOf(row);
    }
    return rect(0, 0);
  };
}

/** Where a row's top sits below the top of the box, the way a reader sees it. */
function topOf(id: string): number {
  const row = scroller.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!row) throw new Error(`no row ${id}`);
  return row.getBoundingClientRect().top;
}

/** The first row the reader can still see. */
function firstVisible(): string {
  for (const row of rows()) if (row.getBoundingClientRect().bottom > 0) return row.dataset.id!;
  throw new Error("nothing visible");
}

/** A drag or a fling: the browser moves the list, then says so. */
function scrollTo(top: number): void {
  act(() => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  });
}

// --- a controllable page of older messages ---------------------------------

const realLoadOlder = useMessages.getState().loadOlder;
let inFlight: { land: (ids: string[]) => void; asked: number };

function stubLoadOlder(): void {
  let settle: (() => void) | null = null;
  inFlight = {
    asked: 0,
    land: (ids) => {
      act(() => {
        useMessages.getState().insert(CHANNEL, ids.map((id) => msg(id)));
        useMessages.getState().setLoading(CHANNEL, false);
      });
      const done = settle;
      settle = null;
      act(() => done?.());
    },
  };
  useMessages.setState({
    loadOlder: (channelId: string) => {
      inFlight.asked++;
      // The real store marks the channel loading before it awaits anything;
      // the list leans on that, so the stand-in does it too.
      useMessages.getState().setLoading(channelId, true);
      return new Promise<void>((res) => {
        settle = res;
      });
    },
  });
}

// --- a ResizeObserver, which jsdom has not ---------------------------------

const observers: ResizeObserverCallback[] = [];

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {
    observers.push(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    const i = observers.indexOf(this.cb);
    if (i >= 0) observers.splice(i, 1);
  }
}

/** Something in the list changed height on its own: a picture finished loading. */
function relayout(): void {
  act(() => {
    for (const cb of [...observers]) cb([], {} as ResizeObserver);
  });
}

// --- the list under test ---------------------------------------------------

/** Seeds `count` messages ending at id `1000 + count` and renders the list. */
function seed(count: number): void {
  const ids = Array.from({ length: count }, (_, i) => String(1001 + i));
  useMessages.setState({
    channels: {
      [CHANNEL]: {
        ids,
        byId: Object.fromEntries(ids.map((id) => [id, msg(id)])),
        hasOlder: true,
        hasNewer: false,
        loading: false,
        loaded: true,
        failed: 0,
        pending: [],
      },
    },
  });
}

function show(): void {
  const view = render(<MessageList channel={channel} />);
  scroller = view.container.querySelector<HTMLElement>("[data-scroller]")!;
  measure();
  // The first layout run sticks to the bottom, which it can only do once it
  // can measure; before `measure()` every height was zero.
  relayout();
}

beforeEach(() => {
  scrollTop = 0;
  heights.clear();
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  stubLoadOlder();
  useAuth.setState({ me: { id: ME, username: "me", display_name: "Me" } as never });
  // A focused list at the bottom marks itself read, which would reach the network.
  useUI.setState({ focused: false, jumpTo: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = realRect;
  useMessages.setState({ loadOlder: realLoadOlder, channels: {} });
});

describe("MessageList keeping the reading position", () => {
  it("does not lose the reading position to an unrelated render while an older page is loading", () => {
    seed(60);
    show();
    // Up near the top of what is loaded, which asks for the page before it.
    scrollTo(200);
    expect(inFlight.asked).toBe(1);
    const keeping = firstVisible();
    const was = topOf(keeping);

    // A message finishes decrypting and lands in the store. This is the render
    // that used to spend the anchor: the list did not get taller, so the height
    // it had noted looked unchanged and it threw the anchor away anyway.
    act(() => useMessages.getState().update(CHANNEL, { ...msg("1030"), payload: { t: "decrypted at last" } }));

    inFlight.land(["951", "952", "953", "954", "955", "956", "957", "958", "959", "960"]);

    expect(firstVisible()).toBe(keeping);
    expect(topOf(keeping)).toBe(was);
    // The complaint itself: with the anchor gone the list stays where it was
    // and the ten messages that arrived above the viewport carry the reader
    // up to the top of the chunk that just loaded.
    expect(scroller.scrollTop).toBe(200 + 10 * ROW);
  });

  it("holds through a stream of unrelated renders, as a DM full of decryptions produces", () => {
    seed(60);
    show();
    scrollTo(600);
    const keeping = firstVisible();
    const was = topOf(keeping);
    expect(inFlight.asked).toBe(0);

    scrollTo(120);
    expect(inFlight.asked).toBe(1);
    const asked = firstVisible();
    const askedAt = topOf(asked);

    for (const id of ["1010", "1022", "1041", "1057"]) {
      act(() => useMessages.getState().update(CHANNEL, { ...msg(id), payload: { t: `${id} decrypted` } }));
    }
    act(() => useMessages.getState().setReaction(CHANNEL, "1044", "👍", THEM, true, false));

    inFlight.land(Array.from({ length: 50 }, (_, i) => String(951 + i)));

    expect(firstVisible()).toBe(asked);
    expect(topOf(asked)).toBe(askedAt);
    // The fling really did move on between the two, so this is not the same
    // row being held all along.
    expect(keeping).not.toBe(asked);
    expect(was).toBeLessThanOrEqual(0);
  });

  it("leaves the reader alone when the list grows below them", () => {
    seed(60);
    show();
    scrollTo(0);
    const keeping = firstVisible();
    const was = topOf(keeping);
    const before = scroller.scrollTop;

    // A picture well below the viewport finally loads. The list is taller than
    // it was, which a height comparison reads as a page of older messages and
    // pays for by shoving the reader down by the height of the picture.
    heights.set("1050", ROW + 300);
    relayout();
    act(() => useMessages.getState().update(CHANNEL, { ...msg("1050"), payload: { t: "picture" } }));

    expect(scroller.scrollTop).toBe(before);
    expect(topOf(keeping)).toBe(was);
  });

  it("takes off what pictures in the page that just landed add above the reader", () => {
    seed(60);
    show();
    scrollTo(0);
    const keeping = firstVisible();
    const was = topOf(keeping);

    inFlight.land(Array.from({ length: 50 }, (_, i) => String(951 + i)));
    expect(topOf(keeping)).toBe(was);

    // The page is on screen before its pictures know how tall they are; nothing
    // renders when they find out, and `.scroll` turns `overflow-anchor` off.
    heights.set("960", ROW + 200);
    heights.set("975", ROW + 120);
    relayout();

    expect(topOf(keeping)).toBe(was);
  });

  it("takes a fresh row to hold when the reader touches the bottom and comes back up", () => {
    seed(60);
    show();
    scrollTo(200);
    expect(inFlight.asked).toBe(1);

    // All the way down and straight back up, all before the page arrives. At
    // the bottom there is nothing worth holding, so coming back up has to take
    // a row again rather than let the page land uncompensated.
    scrollTo(maxScroll());
    scrollTo(160);
    const keeping = firstVisible();
    const was = topOf(keeping);

    inFlight.land(Array.from({ length: 50 }, (_, i) => String(951 + i)));

    expect(topOf(keeping)).toBe(was);
    expect(scroller.scrollTop).toBe(160 + 50 * ROW);
  });

  it("asks for one page however hard the list is flung", () => {
    seed(60);
    show();
    act(() => {
      for (const top of [900, 600, 300, 100, 40, 0]) {
        scroller.scrollTop = top;
        fireEvent.scroll(scroller);
      }
    });
    expect(inFlight.asked).toBe(1);
  });
});

describe("MessageList behaviours the anchoring must not cost", () => {
  it("sticks to the bottom when the reader is at the bottom", () => {
    seed(20);
    show();
    expect(scroller.scrollTop).toBe(maxScroll());
    const wasMax = maxScroll();

    act(() => useMessages.getState().insert(CHANNEL, [msg("1021")]));
    expect(scroller.scrollTop).toBe(maxScroll());
    expect(maxScroll()).toBe(wasMax + ROW);
  });

  it("shows your own message wherever you were reading", () => {
    seed(60);
    show();
    scrollTo(600);
    expect(scroller.scrollTop).toBe(600);

    act(() =>
      useMessages.getState().addPending({
        tmpId: "t1",
        nonce: "n1",
        channelId: CHANNEL,
        authorId: ME,
        payload: { t: "mine" },
        createdAt: 1,
        status: "sending",
      }),
    );

    expect(scroller.scrollTop).toBe(maxScroll());
  });

  it("offers the new-messages pill instead of moving a reader who has scrolled up", () => {
    seed(60);
    show();
    scrollTo(600);
    const keeping = firstVisible();
    const was = topOf(keeping);

    act(() => useMessages.getState().insert(CHANNEL, [msg("1061")]));

    expect(scroller.scrollTop).toBe(600);
    expect(topOf(keeping)).toBe(was);
    // it counts what came in, and says since when
    expect(document.body.textContent).toMatch(/1 new message since \d{1,2}:\d{2}/);
  });
});
