// @vitest-environment jsdom
import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach } from "vitest";
import { RecoveryKey, passwordStrength, usePageTitle, usernameProblem } from "./AuthLayout";

afterEach(cleanup);

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
  it("breaks a recovery key only between its groups, and keeps it one string", () => {
    const { container } = render(<RecoveryKey value="AAAA1111-BBBB2222-CCCC3333" />);
    const box = container.firstElementChild!;
    expect(box.textContent).toBe("AAAA1111-BBBB2222-CCCC3333");
    expect(box.querySelectorAll("wbr")).toHaveLength(2);
  });
  it("names the tab after the page and gives the name back", () => {
    document.title = "Nexa";
    const { unmount, rerender } = renderHook(({ title, when }) => usePageTitle(title, when), { initialProps: { title: "Log In", when: true } });
    expect(document.title).toBe("Log In · Nexa");
    rerender({ title: "Log In", when: false });
    expect(document.title).toBe("Nexa");
    rerender({ title: "Terms", when: true });
    expect(document.title).toBe("Terms · Nexa");
    unmount();
    expect(document.title).toBe("Nexa");
  });
});
