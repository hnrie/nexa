import { describe, expect, it } from "vitest";
import { cleanPermissions, DANGEROUS_PERMISSIONS, grantChange, inOrder, PERMISSIONS, permissionWords } from "./permissions";

describe("permissions", () => {
  it("has words for every permission", () => {
    for (const p of PERMISSIONS) {
      const w = permissionWords(p);
      expect(w.name).not.toMatch(/^look\./);
      expect(w.hint).not.toMatch(/^look\./);
    }
    expect(DANGEROUS_PERMISSIONS).toEqual(["stores"]);
  });

  it("keeps only the known names, once each", () => {
    expect(cleanPermissions(["users.read", "nope", "users.read", 3, "stores"])).toEqual(["users.read", "stores"]);
    expect(inOrder(["stores", "ui.write", "users.read"])).toEqual(["users.read", "ui.write", "stores"]);
  });

  it("says what new code keeps, adds and drops", () => {
    expect(grantChange(["users.read", "ui.write"], ["ui.write", "stores", "users.self.read"])).toEqual({ keep: ["ui.write"], added: ["users.self.read", "stores"], dropped: ["users.read"] });
    expect(grantChange([], ["events.read"])).toEqual({ keep: [], added: ["events.read"], dropped: [] });
  });
});
