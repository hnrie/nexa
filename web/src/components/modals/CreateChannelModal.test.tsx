import { describe, expect, it } from "vitest";
import { slug, typedChannelName } from "./CreateChannelModal";

describe("a text channel's name", () => {
  it("is shown as it will be stored while it is typed", () => {
    expect(typedChannelName("Plans For The Weekend")).toBe("plans-for-the-weekend");
    // the dash for a space arrives as the space is typed, so typing can go on
    expect(typedChannelName("plans ")).toBe("plans-");
    expect(typedChannelName("a  b")).toBe("a-b");
  });

  it("loses the dashes left hanging at either end when it is saved", () => {
    expect(slug(" plans- ")).toBe("plans");
    expect(slug("Ünïcode Stays")).toBe("ünïcode-stays");
  });
});
