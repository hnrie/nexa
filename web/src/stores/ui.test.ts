import { beforeEach, describe, expect, it } from "vitest";
import { useUI } from "./ui";

describe("setActiveChannel", () => {
  beforeEach(() => useUI.setState({ activeChannelId: "1", replyTo: { channelId: "1", messageId: "9", ping: true }, editing: { channelId: "1", messageId: "8" } }));
  it("keeps a reply and an edit when the open channel is activated again", () => {
    useUI.getState().setActiveChannel("1");
    expect(useUI.getState().replyTo?.messageId).toBe("9");
    expect(useUI.getState().editing?.messageId).toBe("8");
  });
  it("drops them when another channel opens", () => {
    useUI.getState().setActiveChannel("2");
    expect(useUI.getState().activeChannelId).toBe("2");
    expect(useUI.getState().replyTo).toBeNull();
    expect(useUI.getState().editing).toBeNull();
  });
});
