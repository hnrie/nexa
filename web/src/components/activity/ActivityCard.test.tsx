// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityCard } from "./ActivityCard";
import { useUI } from "@/stores/ui";
vi.mock("@/components/common/ScrollingText", () => ({ ScrollGroup: ({ children }: {children: React.ReactNode}) => <>{children}</>, ScrollingText: ({ children }: {children: React.ReactNode}) => <span>{children}</span> }));
afterEach(() => { cleanup(); useUI.getState().closeAllModals(); vi.restoreAllMocks(); });
it("shows a custom button's actual host and reviews the complete URL before opening it", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<ActivityCard activity={{ name: "A game", type: 0, created_at: 1, buttons: [{ label: "nexa.fish", url: "https://evil.example/account" }] }} />);
  const button = screen.getByRole("link", {name: /nexa.fish/});
  expect(button.textContent).toContain("evil.example");
  fireEvent.click(button);
  expect(open).not.toHaveBeenCalled();
  const modal = useUI.getState().modal;
  expect(modal?.kind).toBe("confirm");
  render(<>{modal?.props?.body as React.ReactNode}</>);
  expect(screen.getByText("https://evil.example/account")).toBeTruthy();
  (modal?.props?.onConfirm as () => void)();
  expect(open).toHaveBeenCalledWith("https://evil.example/account", "_blank", "noopener,noreferrer");
});
it("does not turn an unsafe activity scheme into a link", () => {
  render(<ActivityCard activity={{ name: "A game", type: 0, created_at: 1, buttons: [{ label: "Open", url: "javascript:alert(1)" }] }} />);
  expect(screen.queryByRole("link")).toBeNull();
});
it("shows Rich Presence song details without destination links or host labels", () => {
  render(<ActivityCard activity={{
    name: "Apple Music",
    type: 2,
    details: "Zero Day",
    details_url: "https://music.apple.com/album/zero-day",
    state: "Ghostemane",
    state_url: "https://music.apple.com/artist/ghostemane",
    assets: { large_text: "Zero Day", large_url: "https://music.apple.com/album/zero-day" },
    created_at: 1,
  }} />);
  expect(screen.getByText("Zero Day")).toBeTruthy();
  expect(screen.getByText("by Ghostemane")).toBeTruthy();
  expect(screen.queryByText("music.apple.com")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
});
