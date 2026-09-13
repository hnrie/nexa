import { describe, expect, it } from "vitest";
import { rolePositionsAfterDrop } from "./rolePositions";

// top first: Owner role 4, Mod 3, Helper 2, Member 1
const roles = [
  { id: "owner", position: 4 },
  { id: "mod", position: 3 },
  { id: "helper", position: 2 },
  { id: "member", position: 1 },
];

describe("rolePositionsAfterDrop", () => {
  it("renumbers every role for the owner", () => {
    expect(rolePositionsAfterDrop(roles, "member", "owner", false, 0, true)).toEqual([
      { id: "member", position: 4 },
      { id: "owner", position: 3 },
      { id: "mod", position: 2 },
      { id: "helper", position: 1 },
    ]);
  });

  it("sends only roles below a moderator's highest role, reusing their positions", () => {
    // a Mod (highest 3) drags Member above Helper
    expect(rolePositionsAfterDrop(roles, "member", "helper", false, 3, false)).toEqual([
      { id: "member", position: 2 },
      { id: "helper", position: 1 },
    ]);
  });

  it("refuses drops onto or of roles the actor cannot manage", () => {
    expect(rolePositionsAfterDrop(roles, "member", "mod", false, 3, false)).toBeNull();
    expect(rolePositionsAfterDrop(roles, "mod", "member", true, 3, false)).toBeNull();
    expect(rolePositionsAfterDrop(roles, "helper", "helper", true, 3, false)).toBeNull();
  });
});
