// @vitest-environment jsdom
import { passwordStrength, usernameProblem } from "./AuthLayout";

describe("auth helpers", () => {
  it("validates usernames like the server", () => {
    expect(usernameProblem("ok_name.1")).toBeNull();
    expect(usernameProblem("a")).toMatch(/2 characters/);
    expect(usernameProblem("Upper")).toMatch(/allowed/);
    expect(usernameProblem(".dot")).toMatch(/Dots/);
    expect(usernameProblem("a..b")).toMatch(/Dots/);
    expect(usernameProblem("x".repeat(33))).toMatch(/32/);
  });
  it("scores password strength monotonically", () => {
    const a = passwordStrength("short").score;
    const b = passwordStrength("longer password").score;
    const c = passwordStrength("Longer Password 42!").score;
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
    expect(c).toBe(4);
  });
});
