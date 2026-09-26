// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("render went wrong");
}

describe("the crash screen", () => {
  const reload = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // past the automatic reloads, so the screen stays up
    localStorage.setItem("crashReloads", "5");
    localStorage.setItem("crashReloadAt", String(Date.now()));
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers safe mode when custom CSS or plugins were on, and starts in it", () => {
    localStorage.setItem("ec:look:active", "1");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByTestId("crash-safe-mode"));
    expect(sessionStorage.getItem("ec:safe")).toBe("manual");
    expect(reload).toHaveBeenCalled();
    // and the crash counts against the plugins that were running
    expect(localStorage.getItem("ec:look:crashes")).toMatch(/^1:/);
  });

  it("does not offer it to someone with neither", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByTestId("crash-safe-mode")).toBeNull();
  });
});
