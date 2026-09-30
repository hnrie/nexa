// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ID_EPOCH } from "@/lib/ids";
import { resetInterrupts } from "@/lib/interrupt";
import { acceptTerms, termsKey } from "@/lib/legal";
import { RELEASES } from "@/lib/whatsNew";
import { useAuth } from "@/stores/auth";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { Sparkles } from "lucide-react";
import { WhatsNew, WhatsNewDialog } from "./WhatsNewDialog";

/** An account id made at a moment, the way the server makes them. */
const idAt = (ms: number) => (BigInt(ms - ID_EPOCH) << 22n).toString();
const OLD = idAt(Date.parse("2026-02-01T00:00:00Z"));

function signIn(id: string, { agreed = true, seen = null as string | null, loaded = true } = {}) {
  if (agreed) acceptTerms(id);
  useAuth.setState({ status: "ready", me: { id } as never });
  useSettings.setState({ loaded, settings: { ...DEFAULT_SETTINGS, whatsNewSeen: seen } });
}

const dialog = () => screen.queryByTestId("whats-new");

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetInterrupts();
  useUI.setState({ modals: [], modal: null, contextMenu: null, quickSwitcher: false });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  cleanup();
  useSettings.getState().reset();
  vi.useRealTimers();
});

describe("What's New", () => {
  it("opens once for an account from before the update, and not again once dismissed", () => {
    signIn(OLD);
    render(<WhatsNew />);
    expect(dialog()).not.toBeNull();
    expect(screen.getByText(/Nexa has been updated/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("whats-new-done"));
    expect(dialog()).toBeNull();
    expect(useSettings.getState().settings.whatsNewSeen).toBe(RELEASES[0]!.id);
    act(() => void vi.advanceTimersByTime(5000));
    expect(dialog()).toBeNull();
  });

  it("waits behind the Terms, and opens once they are agreed to", () => {
    signIn(OLD, { agreed: false });
    render(<WhatsNew />);
    expect(dialog()).toBeNull();
    act(() => acceptTerms(OLD));
    act(() => void vi.advanceTimersByTime(1000));
    expect(localStorage.getItem(termsKey(OLD))).not.toBeNull();
    expect(dialog()).not.toBeNull();
  });

  it("says nothing to an account made after the update, or one that has seen it on another device", () => {
    signIn(idAt(Date.now()));
    const { unmount } = render(<WhatsNew />);
    expect(dialog()).toBeNull();
    unmount();
    signIn(OLD, { seen: RELEASES[0]!.id });
    render(<WhatsNew />);
    expect(dialog()).toBeNull();
  });

  it("waits for the account's settings, which say what it has seen", () => {
    signIn(OLD, { loaded: false });
    render(<WhatsNew />);
    expect(dialog()).toBeNull();
    act(() => useSettings.setState({ loaded: true }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(dialog()).not.toBeNull();
  });

  it("does not open over another dialog or while someone is writing", () => {
    signIn(OLD);
    useUI.setState({ modals: [{ id: 1, kind: "settings" }] });
    const box = document.createElement("textarea");
    document.body.append(box);
    render(<WhatsNew />);
    act(() => void vi.advanceTimersByTime(3000));
    expect(dialog()).toBeNull();
    useUI.setState({ modals: [] });
    box.value = "half a sentence";
    box.focus();
    act(() => void vi.advanceTimersByTime(3000));
    expect(dialog()).toBeNull();
    box.value = "";
    act(() => void vi.advanceTimersByTime(1000));
    expect(dialog()).not.toBeNull();
    box.remove();
  });

  it("shows an account that saw the first release of a day only what came after it", () => {
    signIn(OLD, { seen: "2026-09-27" });
    render(<WhatsNew />);
    expect(screen.getByText("A Right-Click Menu for Text")).toBeTruthy();
    expect(screen.queryByText("Create Polls")).toBeNull();
  });

  it("puts the releases of one day under one date", () => {
    const item = (name: string) => ({ icon: Sparkles, title: `whatsNew.test.${name}Title`, body: `whatsNew.test.${name}Body` });
    const releases = [{ id: "2026-09-26.2", items: [item("later")] }, { id: "2026-09-26", items: [item("earlier")] }, { id: "2026-09-20", items: [item("before")] }];
    render(<WhatsNewDialog releases={releases} onClose={() => {}} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["September 26, 2026", "September 20, 2026"]);
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["whatsNew.test.laterTitle", "whatsNew.test.earlierTitle", "whatsNew.test.beforeTitle"]);
  });
});
