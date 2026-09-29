// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminBadge, AdminHammer, OwnerBadge } from "./OwnerBadge";

afterEach(cleanup);

describe("admin hammer", () => {
  it("draws one labelled hammer at the size asked for", () => {
    const { container } = render(<AdminHammer size={16} />);
    const mark = screen.getByRole("img", { name: "Admin" });
    expect(mark.getAttribute("width")).toBe("16");
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("puts the word Admin in the badge, as the owner's says Owner", () => {
    render(
      <>
        <AdminBadge />
        <OwnerBadge />
      </>,
    );
    expect(screen.getAllByText("Admin")).toHaveLength(1);
    expect(screen.getAllByText("Owner")).toHaveLength(1);
  });
});

describe("the badges on a profile", () => {
  it("say what they mean when pointed at", () => {
    vi.useFakeTimers();
    try {
      render(
        <>
          <OwnerBadge />
          <AdminBadge />
        </>,
      );
      fireEvent.mouseEnter(screen.getByTestId("owner-badge").parentElement!);
      act(() => void vi.advanceTimersByTime(400));
      expect(screen.getByRole("tooltip").textContent).toBe("Owner of this Nexa instance");
      fireEvent.mouseLeave(screen.getByTestId("owner-badge").parentElement!);
      fireEvent.mouseEnter(screen.getByTestId("admin-badge").parentElement!);
      act(() => void vi.advanceTimersByTime(400));
      expect(screen.getByRole("tooltip").textContent).toBe("Admin of this Nexa instance");
    } finally {
      vi.useRealTimers();
    }
  });
});
