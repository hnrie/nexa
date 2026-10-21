import { describe, expect, it } from "vitest";
import { botId } from "./copyId";

describe("botId", () => {
  // internal/botproto/snow.go: a Nexa id plus (Nexa's epoch - Discord's) << 22
  it("adds the bots' offset", () => {
    expect(botId("95740955126136832")).toBe("1551815399106936832");
  });

  it("keeps ids past 2^53 exact", () => {
    expect(botId("9007199254740993")).toBe("1465081643235540993");
  });
});
