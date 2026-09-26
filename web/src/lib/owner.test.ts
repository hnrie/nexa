import { afterEach, describe, expect, it } from "vitest";
import type { NexaState } from "@/api/moderation";
import { useNexa } from "@/stores/nexa";
import { isOwner, ownerId, OWNER_ID } from "./owner";

const state = (owner_id?: string) => ({ account_id: "1", mute: null, ban: null, pending: [], unread: 0, latest: 0, people: {}, ...(owner_id === undefined ? {} : { owner_id }) }) as NexaState;

afterEach(() => useNexa.setState({ state: null }));

describe("the instance owner", () => {
  it("is the one the server names", () => {
    useNexa.setState({ state: state("555") });
    expect(ownerId()).toBe("555");
    expect(isOwner("555")).toBe(true);
    expect(isOwner(OWNER_ID)).toBe(false);
  });

  it("is the built-in one until the server says, or when it cannot", () => {
    expect(ownerId()).toBe(OWNER_ID);
    useNexa.setState({ state: state() });
    expect(isOwner(OWNER_ID)).toBe(true);
    // an instance with no owner yet
    useNexa.setState({ state: state("0") });
    expect(ownerId()).toBe(OWNER_ID);
    expect(isOwner(null)).toBe(false);
  });
});
