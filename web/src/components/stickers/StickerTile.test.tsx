// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StillSource, StillView } from "@/lib/stickerStills";
import { hoverPlays, moves, StillFace } from "./StickerTile";

const gif: StillSource = { kind: "sticker", blobId: "7", format: "gif", animated: true };
const ready: StillView = { status: "ready", url: "blob:still", permanent: false };

afterEach(cleanup);

describe("StillFace", () => {
  it("shows the still, a quiet placeholder while loading, and says when it could not load", () => {
    const { container, rerender } = render(<StillFace view={{ status: "loading", url: null, permanent: false }} src={gif} alt="" play={false} />);
    expect(container.querySelector("[data-sticker-state=loading]")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    rerender(<StillFace view={{ status: "failed", url: null, permanent: false }} src={gif} alt="" play={false} />);
    expect(container.textContent).toContain("Couldn't load");
    rerender(<StillFace view={ready} src={gif} alt="Wave" play={false} />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:still");
    expect(container.textContent).not.toContain("Couldn't load");
  });

  it("plays the moving sticker over the still, and hides the still once it has drawn so the two never show through each other", () => {
    const { container, rerender } = render(<StillFace view={ready} src={gif} alt="" play />);
    const [still, moving] = [...container.querySelectorAll("img")];
    expect(moving!.getAttribute("src")).toContain("/media/sticker/7");
    // until the moving one has loaded, the still is what shows
    expect(still!.style.visibility).toBe("");
    act(() => {
      fireEvent.load(moving!);
    });
    expect(still!.style.visibility).toBe("hidden");
    // pointing away: the moving one goes and the still is back
    rerender(<StillFace view={ready} src={gif} alt="" play={false} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")!.style.visibility).toBe("");
  });

  it("plays nothing before there is a still to fall back to", () => {
    const { container } = render(<StillFace view={{ status: "loading", url: null, permanent: false }} src={gif} alt="" play />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("tile helpers", () => {
  it("plays on a mouse or pen hover, never under a finger that is about to send it", () => {
    expect(hoverPlays({ pointerType: "mouse" })).toBe(true);
    expect(hoverPlays({ pointerType: "pen" })).toBe(true);
    expect(hoverPlays({ pointerType: "touch" })).toBe(false);
  });

  it("knows which stickers move", () => {
    expect(moves(gif)).toBe(true);
    expect(moves({ kind: "sticker", blobId: "1", format: "tgs", animated: false })).toBe(true);
    expect(moves({ kind: "sticker", blobId: "1", format: "png", animated: false })).toBe(false);
  });
});
