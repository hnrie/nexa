// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrCode } from "./QrCode";

const URI = "otpauth://totp/chat.evilion.xyz:alice?algorithm=SHA1&digits=6&issuer=chat.evilion.xyz&period=30&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function svgOf(text: string) {
  const { container } = render(<QrCode text={text} size={200} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  return svg;
}

describe("QrCode", () => {
  it("draws a square grid with the four-module quiet zone the spec wants", () => {
    const svg = svgOf(URI);
    const [x, y, w, h] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
    expect([x, y]).toEqual([0, 0]);
    expect(w).toBe(h);
    // Every QR version is 21 + 4n modules across; plus 8 for the quiet zone.
    expect(((w as number) - 8 - 21) % 4).toBe(0);
    expect(svg.querySelector("g")?.getAttribute("transform")).toBe("translate(4 4)");
  });

  it("places the finder patterns where a scanner looks for them", () => {
    const svg = svgOf(URI);
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    const dark = (col: number, row: number) => d.includes(`M${col} ${row}h1v1h-1z`);
    const span = Number((svg.getAttribute("viewBox") ?? "").split(" ")[2]) - 8;
    // A finder is a solid 3x3 core, a light ring, then a dark 7x7 border.
    const finderAt = (ox: number, oy: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (dark(ox + c, oy + r) !== (edge || core)) return false;
        }
      }
      return true;
    };
    expect(finderAt(0, 0)).toBe(true);
    expect(finderAt(span - 7, 0)).toBe(true);
    expect(finderAt(0, span - 7)).toBe(true);
    // The separator that frames a finder is always light.
    for (let i = 0; i < 8; i++) {
      expect(dark(7, i)).toBe(false);
      expect(dark(i, 7)).toBe(false);
    }
    // Nothing is drawn outside the grid, so the quiet zone stays empty.
    expect(dark(span, 0)).toBe(false);
  });

  it("encodes different text differently and the same text the same way", () => {
    const a = svgOf(URI).querySelector("path")?.getAttribute("d");
    const b = svgOf(URI).querySelector("path")?.getAttribute("d");
    const c = svgOf(URI.replace("alice", "bob")).querySelector("path")?.getAttribute("d");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("labels itself for people who cannot see it", () => {
    const svg = svgOf(URI);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("QR code");
  });
});
