// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Autocomplete, type AcItem } from "./Autocomplete";

const items: AcItem[] = [
  { kind: "command", name: "shrug", desc: "¯\\_(ツ)_/¯" },
  { kind: "command", name: "tableflip", desc: "(╯°□°)╯︵ ┻━┻" },
  { kind: "command", name: "unflip", desc: "┬─┬ノ( º _ ºノ)" },
];

afterEach(cleanup);

describe("Autocomplete", () => {
  it("leaves the choice to the keyboard until the mouse really moves", () => {
    const onHover = vi.fn();
    render(<Autocomplete kind="command" items={items} index={0} onHover={onHover} onPick={() => undefined} tone={0} />);
    const rows = screen.getAllByRole("option");
    // the mouse sits still where the list has just come up under it
    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 400 });
    fireEvent.mouseOver(rows[2]!, { screenX: 300, screenY: 400 });
    fireEvent.mouseMove(rows[2]!, { screenX: 300, screenY: 400 });
    expect(onHover).not.toHaveBeenCalled();
    // and then moves, over another row
    fireEvent.mouseMove(rows[1]!, { screenX: 302, screenY: 380 });
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it("does not take a twitch of a hand on the mouse, after a key press, for a move", () => {
    const onHover = vi.fn();
    render(<Autocomplete kind="command" items={items} index={0} onHover={onHover} onPick={() => undefined} tone={0} />);
    const rows = screen.getAllByRole("option");
    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 400 });
    fireEvent.keyDown(document.body, { key: "s" });
    fireEvent.mouseMove(rows[2]!, { screenX: 301, screenY: 400 });
    fireEvent.mouseMove(rows[2]!, { screenX: 302, screenY: 402 });
    expect(onHover).not.toHaveBeenCalled();
    // a real move, a row further on
    fireEvent.mouseMove(rows[1]!, { screenX: 305, screenY: 370 });
    expect(onHover).toHaveBeenCalledWith(1);
  });
});
