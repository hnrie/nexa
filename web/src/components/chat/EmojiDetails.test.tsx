// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RenderCtx } from "@/markdown/ast";
import { Markdown } from "@/markdown/render";
import { ensureTwemojiIndex, onTwemojiIndexReady, twemojiIndexSettled } from "@/lib/twemoji";
import { useExpressions } from "@/stores/expressions";
import { useServers, type ServerState } from "@/stores/servers";
import { EmojiDetails, emojiOf } from "./EmojiDetails";

const ctx: RenderCtx = { users: {}, channels: {}, roles: {}, emojiUrl: (id) => `/media/emoji/${id}` };

function renderWith(source: string) {
  return render(
    <>
      <Markdown source={source} ctx={ctx} />
      <EmojiDetails />
    </>,
  );
}

beforeAll(async () => {
  // pictures are only drawn once it is known which exist
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(["1f600"]))));
  ensureTwemojiIndex();
  await new Promise<void>((resolve) => (twemojiIndexSettled() ? resolve() : onTwemojiIndexReady(resolve)));
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useExpressions.setState({ emojis: {}, packs: {} });
  useServers.setState({ byId: {} });
});

describe("what a box says it holds", () => {
  it("reads a custom emoji's picture, name and whether it moves", () => {
    const { container } = render(<Markdown source="<a:party:77>" ctx={ctx} />);
    expect(emojiOf(container.querySelector("[data-emoji-card]") as HTMLElement)).toEqual({ kind: "custom", id: "77", name: "party", animated: true });
  });

  it("reads a standard emoji's character", () => {
    const { container } = render(<Markdown source={"hi \u{1F600}"} ctx={ctx} />);
    expect(emojiOf(container.querySelector("[data-emoji-card]") as HTMLElement)).toEqual({ kind: "unicode", text: "\u{1F600}" });
  });
});

describe("the emoji details card", () => {
  it("names a custom emoji and the server of yours it comes from when pressed", () => {
    useExpressions.setState({ emojis: { s1: [{ id: "e1", server_id: "s1", name: "party", blob_id: "77", animated: false, creator_id: "u", created_at: 0 }] } });
    useServers.setState({ byId: { s1: { server: { id: "s1", name: "Design Club" } } as ServerState } });
    const { container } = renderWith("shipping it <:party:77>");
    fireEvent.click(container.querySelector("[data-emoji-card]")!);
    const card = screen.getByTestId("emoji-details");
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.textContent).toContain(":party:");
    expect(card.textContent).toContain("From Design Club");
  });

  it("says a custom emoji from nowhere of yours is a custom emoji", () => {
    const { container } = renderWith("<:stranger:88>");
    fireEvent.click(container.querySelector("[data-emoji-card]")!);
    expect(screen.getByTestId("emoji-details").textContent).toContain("A custom emoji");
  });

  it("names a standard emoji by the :name: that types it", async () => {
    const { container } = renderWith("hello \u{1F600}");
    fireEvent.click(container.querySelector("[data-emoji-card]")!);
    // the table of names arrives when first needed
    expect(await screen.findByText(":grinning:", undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId("emoji-details").textContent).toContain("A standard emoji anyone can use");
  });

  it("shows a pointed-at emoji after a moment, out of the pointer's way, and goes when the pointer does", () => {
    vi.useFakeTimers();
    const { container } = renderWith("<:party:77>");
    const box = container.querySelector("[data-emoji-card]")!;
    fireEvent.pointerOver(box);
    expect(screen.queryByTestId("emoji-details")).toBeNull();
    act(() => void vi.advanceTimersByTime(400));
    const card = screen.getByTestId("emoji-details");
    expect(card.getAttribute("role")).toBe("tooltip");
    expect(card.getAttribute("data-pinned")).toBe("false");
    fireEvent.pointerOut(box, { relatedTarget: document.body });
    expect(screen.queryByTestId("emoji-details")).toBeNull();
  });

  it("closes a pressed card with Escape, or a second press", () => {
    const { container } = renderWith("<:party:77>");
    const box = container.querySelector("[data-emoji-card]")!;
    fireEvent.click(box);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("emoji-details")).toBeNull();
    fireEvent.click(box);
    expect(screen.getByTestId("emoji-details")).toBeTruthy();
    fireEvent.click(box);
    expect(screen.queryByTestId("emoji-details")).toBeNull();
  });

  it("leaves an emoji inside a link to the link", () => {
    const { container } = renderWith("[<:party:77> party](https://example.com)");
    fireEvent.click(container.querySelector("[data-emoji-card]")!);
    expect(screen.queryByTestId("emoji-details")).toBeNull();
  });
});
