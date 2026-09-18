// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReorder } from "./useReorder";

/** The hook re-focuses the moved row on the next frame. */
async function settle() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

function List({ ids, move, axis }: { ids: string[]; move: (id: string, delta: number) => boolean; axis?: "vertical" | "grid" }) {
  const reorder = useReorder({ ids, move, name: (id) => id, ...(axis ? { axis } : {}) });
  return (
    <div>
      {reorder.live}
      {ids.map((id) => (
        <button key={id} data-reorder-id={id} data-testid={id} onKeyDown={reorder.onKeyDown(id)}>
          {id}
        </button>
      ))}
      <ul data-testid="menu">
        {reorder.menuItems(ids[1] ?? "").map((m) => (
          <li key={m.id}>{m.id}</li>
        ))}
      </ul>
    </div>
  );
}

afterEach(cleanup);

describe("useReorder", () => {
  it("moves a row with Alt and an arrow, and leaves plain arrows to the list", async () => {
    const move = vi.fn(() => true);
    render(<List ids={["a", "b", "c"]} move={move} />);
    fireEvent.keyDown(screen.getByTestId("b"), { key: "ArrowDown" });
    expect(move).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("b"), { key: "ArrowDown", altKey: true });
    expect(move).toHaveBeenCalledWith("b", 1);
    fireEvent.keyDown(screen.getByTestId("b"), { key: "ArrowUp", altKey: true });
    expect(move).toHaveBeenLastCalledWith("b", -1);
    await settle();
  });

  it("will not walk off either end", async () => {
    const move = vi.fn(() => true);
    render(<List ids={["a", "b", "c"]} move={move} />);
    fireEvent.keyDown(screen.getByTestId("a"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(screen.getByTestId("c"), { key: "ArrowDown", altKey: true });
    await settle();
    expect(move).not.toHaveBeenCalled();
  });

  it("says where the thing landed, in a region that was already there", async () => {
    render(<List ids={["a", "b", "c"]} move={() => true} />);
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    fireEvent.keyDown(screen.getByTestId("a"), { key: "ArrowDown", altKey: true });
    await settle();
    expect(screen.getByRole("status")).toBe(live);
    expect(live.textContent).not.toBe("");
  });

  it("says nothing when the move was refused", async () => {
    render(<List ids={["a", "b", "c"]} move={() => false} />);
    fireEvent.keyDown(screen.getByTestId("a"), { key: "ArrowDown", altKey: true });
    await settle();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("keeps focus on the row it moved", async () => {
    render(<List ids={["a", "b", "c"]} move={() => true} />);
    screen.getByTestId("b").focus();
    fireEvent.keyDown(screen.getByTestId("b"), { key: "ArrowDown", altKey: true });
    await settle();
    expect(document.activeElement).toBe(screen.getByTestId("b"));
  });

  it("offers the same move as menu items, which is the only path a finger has", () => {
    render(<List ids={["a", "b", "c"]} move={() => true} />);
    expect([...screen.getByTestId("menu").querySelectorAll("li")].map((li) => li.textContent)).toEqual(["move-up", "move-down"]);
  });

  it("moves left and right in a grid", async () => {
    const move = vi.fn(() => true);
    render(<List ids={["a", "b", "c"]} move={move} axis="grid" />);
    fireEvent.keyDown(screen.getByTestId("b"), { key: "ArrowRight", altKey: true });
    expect(move).toHaveBeenCalledWith("b", 1);
    fireEvent.keyDown(screen.getByTestId("b"), { key: "ArrowLeft", altKey: true });
    await settle();
    expect(move).toHaveBeenLastCalledWith("b", -1);
  });
});
