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

  it("keeps an edit for when its channel opens again, with what was typed", () => {
    useUI.setState({ editDrafts: {} });
    useUI.getState().setEditDraft("1", "8", "half written");
    useUI.getState().setActiveChannel("2");
    expect(useUI.getState().editing).toBeNull();
    useUI.getState().setActiveChannel(null);
    useUI.getState().setActiveChannel("1");
    expect(useUI.getState().editing).toEqual({ channelId: "1", messageId: "8" });
    expect(useUI.getState().editDrafts["1"]).toEqual({ messageId: "8", text: "half written" });
  });
  it("keeps an edit nothing was typed into yet", () => {
    useUI.setState({ editDrafts: {} });
    useUI.getState().setActiveChannel("2");
    useUI.getState().setActiveChannel("1");
    expect(useUI.getState().editing).toEqual({ channelId: "1", messageId: "8" });
    expect(useUI.getState().editDrafts["1"]?.text).toBeNull();
  });
  it("forgets the kept text once the edit ends", () => {
    useUI.setState({ editDrafts: {} });
    useUI.getState().setEditDraft("1", "8", "half written");
    useUI.getState().setEditing(null);
    expect(useUI.getState().editDrafts["1"]).toBeUndefined();
    useUI.getState().setActiveChannel("2");
    useUI.getState().setActiveChannel("1");
    expect(useUI.getState().editing).toBeNull();
  });
  it("ends a saved edit in the channel it belongs to, even after another channel opened", () => {
    useUI.setState({ editDrafts: {} });
    useUI.getState().setEditDraft("1", "8", "saving this");
    useUI.getState().setActiveChannel("2");
    useUI.getState().setEditing({ channelId: "2", messageId: "5" });
    // the save of message 8 finishes now
    useUI.getState().endEdit("1", "8");
    expect(useUI.getState().editing).toEqual({ channelId: "2", messageId: "5" });
    expect(useUI.getState().editDrafts["1"]).toBeUndefined();
    useUI.getState().setActiveChannel("1");
    expect(useUI.getState().editing).toBeNull();
  });
});
