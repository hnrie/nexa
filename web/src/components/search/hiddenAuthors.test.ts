import { afterEach, describe, expect, it } from "vitest";
import type { Relationship } from "@/api/types";
import { useRelationships } from "@/stores/relationships";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { authorsHiddenFromSearch } from "./useSearch";

function rel(id: string, type: Relationship["type"]): Relationship {
  return { type, nickname: "", created_at: 0, user: { id, username: id, display_name: id, avatar_id: null } as Relationship["user"] };
}

afterEach(() => {
  useRelationships.getState().clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

describe("authorsHiddenFromSearch", () => {
  it("keeps blocked people in results while their messages only fold away", () => {
    useRelationships.getState().setMany([rel("carol", "blocked"), rel("bob", "friend")]);
    expect(authorsHiddenFromSearch()).toEqual([]);
  });

  it("leaves blocked people out once their messages are hidden completely", () => {
    useRelationships.getState().setMany([rel("carol", "blocked"), rel("bob", "friend")]);
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, blocking: { ...DEFAULT_SETTINGS.blocking, hideMessages: true } } });
    expect(authorsHiddenFromSearch()).toEqual(["carol"]);
  });
});
