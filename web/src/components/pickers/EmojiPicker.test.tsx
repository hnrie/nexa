// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSettings } from "@/stores/settings";
import { EmojiPicker } from "./EmojiPicker";

vi.mock("./emojiIndex", () => {
  const items = [{ hexcode: "1F600", unicode: "😀", label: "grinning", shortcodes: ["grinning"] }, { hexcode: "1F389", unicode: "🎉", label: "party", shortcodes: ["tada"] }];
  return { emojiLoaded: () => true, loadEmoji: async () => {}, emojiGroups: () => [{ id: 0, name: "Faces", items }], searchEmoji: () => items, spriteStyle: () => undefined, withTone: (s: string | { unicode: string }) => typeof s === "string" ? s : s.unicode, toneNames: () => ["Default"] };
});
afterEach(cleanup);
it("holds frequent emoji positions for repeated picks and refreshes on reopening", () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  const initial = useSettings.getState();
  useSettings.setState({ settings: { ...initial.settings, recentEmoji: ["😀", "🎉"] }, patch: (p) => { useSettings.setState((s) => ({ settings: { ...s.settings, ...p } })); } });
  try {
    const pick = vi.fn();
    const view = render(<EmojiPicker onPick={pick} />);
    const cells = () => [...view.getByTestId("emoji-grid").querySelectorAll<HTMLButtonElement>("button[data-emoji]")];
    expect(cells().slice(0, 2).map((b) => b.dataset.emoji)).toEqual(["😀", "🎉"]);
    for (let i = 0; i < 8; ++i) fireEvent.click(cells()[1]!, { shiftKey: true });
    expect(pick).toHaveBeenCalledTimes(8);
    expect(pick.mock.calls.every(([e]) => e.unicode === "🎉")).toBe(true);
    expect(cells().slice(0, 2).map((b) => b.dataset.emoji)).toEqual(["😀", "🎉"]);
    expect(useSettings.getState().settings.recentEmoji[0]).toBe("🎉");
    view.unmount();
    const reopened = render(<EmojiPicker onPick={pick} />);
    expect(reopened.getByTestId("emoji-grid").querySelector<HTMLButtonElement>("button[data-emoji]")?.dataset.emoji).toBe("🎉");
  } finally { act(() => useSettings.setState(initial)); }
});
