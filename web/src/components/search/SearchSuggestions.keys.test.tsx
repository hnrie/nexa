// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Names } from "./scope";
import { SearchSuggestions, useSuggestionKeys } from "./SearchSuggestions";
import { suggest, type Suggestion } from "./suggest";

afterEach(cleanup);

const names: Names = { users: {}, meId: undefined, person: () => "", channel: () => "", serverName: () => null, ctx: { users: {}, channelNames: {} } };

/** A search box with its suggestions, the way the search surfaces put them together. */
function Box({ onPick, onDismiss = () => undefined }: { onPick: (s: Suggestion) => void; onDismiss?: () => void }) {
  const [q, setQ] = useState("has:");
  const groups = suggest({ raw: q, caret: q.length, names, channels: [], nearby: [], recent: [], now: 0 });
  const sk = useSuggestionKeys(groups, onPick, onDismiss);
  return (
    <>
      <input aria-label="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => void sk.key(e)} aria-activedescendant={sk.activeId ? `sug-${sk.activeId}` : undefined} />
      <SearchSuggestions groups={groups} active={sk.active} listId="sug" names={names} onPick={onPick} onHover={sk.setActive} onDate={() => undefined} />
    </>
  );
}

describe("suggestions from the keyboard", () => {
  it("walk with the arrows from the search box, and Enter takes the one chosen", () => {
    const onPick = vi.fn();
    render(<Box onPick={onPick} />);
    const box = screen.getByLabelText("search");
    // nothing chosen yet: Enter is left to the box, which searches
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const rows = screen.getAllByRole("option");
    expect(rows[1]!.getAttribute("aria-selected")).toBe("true");
    expect(box.getAttribute("aria-activedescendant")).toBe(rows[1]!.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ text: "has:image " }));
  });

  it("wraps from the first row up to the last, and Tab takes a row too", () => {
    const onPick = vi.fn();
    render(<Box onPick={onPick} />);
    const box = screen.getByLabelText("search");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const rows = screen.getAllByRole("option");
    expect(rows[rows.length - 1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ text: "has:sticker " }));
  });

  it("puts the suggestions away on Escape, and chooses with a click", () => {
    const onPick = vi.fn();
    const onDismiss = vi.fn();
    render(<Box onPick={onPick} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByLabelText("search"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("option")[2]!);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ text: "has:video " }));
  });
});
