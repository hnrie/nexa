import { afterEach, describe, expect, it } from "vitest";
import type { Relationship } from "@/api/types";
import { useRelationships } from "@/stores/relationships";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { randomBytes } from "@/crypto/bytes";
import { encryptSettings } from "@/lib/settingsCrypto";
import { blockRules, currentBlockRules, isBlocked, isQuiet, messageFate } from "./blocked";

function rel(id: string, type: Relationship["type"]): Relationship {
  return { type, nickname: "", created_at: 0, user: { id, username: id, display_name: id, avatar_id: null } as Relationship["user"] };
}

const rels = { carol: rel("carol", "blocked"), bob: rel("bob", "friend"), dave: rel("dave", "incoming") };
const msg = (author: string, extra: Partial<{ type: string; reply_to_id: string | null }> = {}) => ({ author_id: author, type: "default", reply_to_id: null, ...extra });
const authors: Record<string, string> = { m1: "carol", m2: "bob" };
const authorOf = (id: string) => authors[id];

afterEach(() => {
  useRelationships.getState().clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

describe("blockRules", () => {
  it("lists only the people this account blocked", () => {
    const rules = blockRules(rels, { hideMessages: false, hideReplies: false });
    expect([...rules.blocked]).toEqual(["carol"]);
    expect(isBlocked("carol", rules)).toBe(true);
    expect(isBlocked("bob", rules)).toBe(false);
    expect(isBlocked(undefined, rules)).toBe(false);
  });

  it("only hides replies while messages are hidden too", () => {
    expect(blockRules(rels, { hideMessages: false, hideReplies: true }).hideReplies).toBe(false);
    expect(blockRules(rels, { hideMessages: true, hideReplies: true }).hideReplies).toBe(true);
  });

  it("reads an older settings copy that has no blocking choices as the defaults", () => {
    expect(blockRules(rels, undefined)).toMatchObject({ hideMessages: false, hideReplies: false });
  });
});

describe("messageFate", () => {
  it("folds a blocked person's messages by default", () => {
    const rules = blockRules(rels, { hideMessages: false, hideReplies: false });
    expect(messageFate(msg("carol"), rules)).toBe("collapse");
    expect(messageFate(msg("bob"), rules)).toBe("show");
    // a note that they joined is not something they said
    expect(messageFate(msg("carol", { type: "system_join" }), rules)).toBe("show");
    // replies to them stay when only folding
    expect(messageFate(msg("bob", { type: "reply", reply_to_id: "m1" }), rules, authorOf)).toBe("show");
  });

  it("leaves their messages out entirely when asked to", () => {
    const rules = blockRules(rels, { hideMessages: true, hideReplies: false });
    expect(messageFate(msg("carol"), rules)).toBe("hide");
    expect(messageFate(msg("carol", { type: "system_pin" }), rules)).toBe("hide");
    expect(messageFate(msg("bob", { type: "reply", reply_to_id: "m1" }), rules, authorOf)).toBe("show");
  });

  it("takes replies to them along when asked to", () => {
    const rules = blockRules(rels, { hideMessages: true, hideReplies: true });
    expect(messageFate(msg("bob", { type: "reply", reply_to_id: "m1" }), rules, authorOf)).toBe("hide");
    // a reply to someone else, or to a message this device has not seen, stays
    expect(messageFate(msg("dave", { type: "reply", reply_to_id: "m2" }), rules, authorOf)).toBe("show");
    expect(messageFate(msg("dave", { type: "reply", reply_to_id: "m9" }), rules, authorOf)).toBe("show");
    expect(messageFate(msg("dave", { type: "reply", reply_to_id: "m1" }), rules)).toBe("show");
  });

  it("shows everything when nobody is blocked", () => {
    const rules = blockRules({ bob: rel("bob", "friend") }, { hideMessages: true, hideReplies: true });
    expect(messageFate(msg("bob"), rules)).toBe("show");
  });
});

describe("isQuiet", () => {
  it("keeps anything from a blocked person quiet, whatever is shown", () => {
    const folding = blockRules(rels, { hideMessages: false, hideReplies: false });
    expect(isQuiet(msg("carol"), folding)).toBe(true);
    expect(isQuiet(msg("carol", { type: "system_join" }), folding)).toBe(true);
    expect(isQuiet(msg("bob"), folding)).toBe(false);
    expect(isQuiet(msg("bob", { type: "reply", reply_to_id: "m1" }), folding, authorOf)).toBe(false);
    const hiding = blockRules(rels, { hideMessages: true, hideReplies: true });
    expect(isQuiet(msg("bob", { type: "reply", reply_to_id: "m1" }), hiding, authorOf)).toBe(true);
  });
});

describe("currentBlockRules", () => {
  it("follows the stores and reuses its answer while they stand still", () => {
    useRelationships.getState().setMany([rel("carol", "blocked")]);
    const first = currentBlockRules();
    expect(first.blocked.has("carol")).toBe(true);
    expect(currentBlockRules()).toBe(first);
    useSettings.getState().patch({ blocking: { hideMessages: true, hideReplies: false } });
    expect(currentBlockRules().hideMessages).toBe(true);
    useRelationships.getState().remove("carol");
    expect(currentBlockRules().blocked.size).toBe(0);
  });
});

describe("the blocking choices in synced settings", () => {
  it("are filled in field by field from a copy saved before they existed", async () => {
    const key = randomBytes(32);
    const settings = useSettings.getState();
    settings.reset();
    settings.setKey(key);
    await settings.load(await encryptSettings(key, { theme: "light" }), 1);
    expect(useSettings.getState().settings.blocking).toEqual({ hideMessages: false, hideReplies: false });
    await settings.load(await encryptSettings(key, { blocking: { hideMessages: true } }), 2);
    expect(useSettings.getState().settings.blocking).toEqual({ hideMessages: true, hideReplies: false });
    await settings.load(await encryptSettings(key, { blocking: "nonsense" }), 3);
    expect(useSettings.getState().settings.blocking).toEqual({ hideMessages: false, hideReplies: false });
    settings.reset();
  });
});
