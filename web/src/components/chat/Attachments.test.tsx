// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMeta } from "@/crypto/message";

// nothing is fetched or decrypted here: the pictures stay on their way
vi.mock("@/lib/mediaCache", async (orig) => ({ ...(await orig<typeof import("@/lib/mediaCache")>()), attachmentObjectURL: vi.fn(() => new Promise(() => undefined)) }));
const { Attachments, mosaicLayout } = await import("./Attachments");

afterEach(cleanup);

const spans = (n: number) => mosaicLayout(n).map((t) => `${t.col}x${t.row}`).join(" ");

describe("mosaicLayout", () => {
  it("lays two to ten pictures out the way a grid of them reads", () => {
    expect(mosaicLayout(1)).toEqual([]);
    expect(spans(2)).toBe("3x1 3x1");
    expect(spans(3)).toBe("4x2 2x1 2x1");
    expect(spans(4)).toBe("3x1 3x1 3x1 3x1");
    expect(spans(5)).toBe("3x1 3x1 2x1 2x1 2x1");
    expect(spans(6)).toBe(Array(6).fill("2x1").join(" "));
    expect(spans(7)).toBe(["6x1", ...Array(6).fill("2x1")].join(" "));
    expect(spans(8)).toBe(["3x1", "3x1", ...Array(6).fill("2x1")].join(" "));
    expect(spans(10)).toBe(["6x1", ...Array(9).fill("2x1")].join(" "));
  });

  it("leaves no row of the six columns half full", () => {
    for (let n = 2; n <= 10; n++) {
      const cells = mosaicLayout(n).reduce((sum, t) => sum + t.col * t.row, 0);
      expect(cells % 6, `${n} pictures`).toBe(0);
    }
  });
});

describe("a message's pictures", () => {
  const pic = (i: number): AttachmentMeta => ({ blob_id: `b${i}`, name: `p${i}.png`, type: "image/png", size: 1000, key: "k", w: 800, h: 600 });
  const file: AttachmentMeta = { blob_id: "f", name: "notes.txt", type: "text/plain", size: 10, key: "k" };

  it("share one grid when there are two or more, ahead of the message's other files", () => {
    const { container } = render(<Attachments list={[pic(1), file, pic(2), pic(3)]} />);
    const grid = screen.getByTestId("picture-grid");
    expect(grid.children).toHaveLength(3);
    expect((grid.children[0] as HTMLElement).style.gridRow).toBe("span 2");
    expect(container.firstElementChild!.firstElementChild).toBe(grid);
    expect(screen.getByText("notes.txt")).toBeTruthy();
  });

  it("stand alone when there is only one", () => {
    render(<Attachments list={[pic(1), file]} />);
    expect(screen.queryByTestId("picture-grid")).toBeNull();
  });
});
