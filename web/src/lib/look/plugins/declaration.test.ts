import { describe, expect, it } from "vitest";
import { readDeclaration } from "./declaration";

describe("reading what a plugin says about itself, without running it", () => {
  it("reads the version, the permissions and who it is from a plainly written plugin", () => {
    const code = `
      // permissions: ["stores"] (an old line, commented out)
      /* apiVersion: 9 */
      export default {
        name: "Keyword alert", description: 'Watches for a word', version: "2.0.0", author: \`You\`,
        apiVersion: 2,
        permissions: ["servers.messages.read", 'events.read', "nope", "events.read",],
        start(api) { api.ui.toast("permissions: [\\"stores\\"]"); },
      };`;
    expect(readDeclaration(code)).toEqual({ apiVersion: 2, permissions: ["servers.messages.read", "events.read"], name: "Keyword alert", description: "Watches for a word", version: "2.0.0", author: "You" });
  });

  it("calls an old plugin version 1, with no list", () => {
    expect(readDeclaration(`export default { name: "Old", start(api) {} }`)).toMatchObject({ apiVersion: 1, permissions: null, name: "Old", author: null });
  });

  it("reads no list that is not written out plainly", () => {
    expect(readDeclaration(`const P = ["stores"]; export default { apiVersion: 2, permissions: [...P], start() {} }`).permissions).toBeNull();
    expect(readDeclaration("export default { apiVersion: 2, permissions: [`${'stores'}`], start() {} }").permissions).toBeNull();
    expect(readDeclaration(`export default { apiVersion: 2, permissions: [], start() {} }`).permissions).toEqual([]);
  });
});
