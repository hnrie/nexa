// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef, type KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchSuggestions, type SuggestHandle } from "./SearchSuggestions";

afterEach(cleanup);

const press = (handle: SuggestHandle, key: string) => {
  const e = { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLInputElement>;
  let used = false;
  act(() => {
    used = handle.key(e);
  });
  return used;
};

describe("filter suggestions from the keyboard", () => {
  it("walk with the arrows from the search box, and Enter takes the one chosen", () => {
    const handle = createRef<SuggestHandle>();
    const onPick = vi.fn();
    const active = vi.fn();
    render(<SearchSuggestions query="has:" users={{}} channels={[]} onPick={onPick} handle={handle} listId="sug" onActive={active} />);
    expect(screen.getByRole("listbox").id).toBe("sug");
    // nothing chosen yet: Enter is left to the box, which searches
    expect(press(handle.current!, "Enter")).toBe(false);
    expect(press(handle.current!, "ArrowDown")).toBe(true);
    expect(press(handle.current!, "ArrowDown")).toBe(true);
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    expect(active).toHaveBeenLastCalledWith("sug-image");
    expect(press(handle.current!, "Enter")).toBe(true);
    expect(onPick).toHaveBeenCalledWith("has:image ");
  });

  it("wraps from the first row up to the last", () => {
    const handle = createRef<SuggestHandle>();
    render(<SearchSuggestions query="has:" users={{}} channels={[]} onPick={() => {}} handle={handle} />);
    press(handle.current!, "ArrowUp");
    const rows = screen.getAllByRole("option");
    expect(rows[rows.length - 1]!.getAttribute("aria-selected")).toBe("true");
  });
});
