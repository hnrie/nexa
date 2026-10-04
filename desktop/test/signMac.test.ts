/**
 * The Mac app is signed to be known by its bundle identifier, so what people
 * allowed it (screen recording, the microphone, the camera) survives updates.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { requirement } = createRequire(import.meta.url)("../sign-mac.cjs") as { requirement: (identifier: string) => Buffer };

describe("the designated requirement", () => {
  it("is identifier \"…\" compiled as Apple's csreq compiles it", () => {
    // csreq -r='identifier "xyz.evilion.chat"' -b
    expect(requirement("xyz.evilion.chat").toString("hex")).toBe("fade0c0000000024000000010000000200000010" + Buffer.from("xyz.evilion.chat").toString("hex"));
  });

  it("pads an identifier to a whole word", () => {
    // csreq -r='identifier "xyz.evilion.chat.nexatest"' -b
    expect(requirement("xyz.evilion.chat.nexatest").toString("hex")).toBe("fade0c000000003000000001000000020000001978797a2e6576696c696f6e2e636861742e6e65786174657374000000");
  });
});
