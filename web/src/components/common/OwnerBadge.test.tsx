// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffBadge, StaffMark } from "./OwnerBadge";

afterEach(cleanup);

describe("staff marks", () => {
  it("draw one labelled mark per rank at the size asked for", () => {
    const { container } = render(
      <>
        <StaffMark rank="owner" size={16} />
        <StaffMark rank="developer" size={16} />
        <StaffMark rank="admin" size={16} />
        <StaffMark rank="mod" size={16} />
      </>,
    );
    for (const name of ["Owner", "Developer", "Admin", "Mod"]) expect(screen.getByRole("img", { name }).getAttribute("width")).toBe("16");
    expect(container.querySelectorAll("svg")).toHaveLength(4);
  });

  it("put the rank's name in the badge", () => {
    render(
      <>
        <StaffBadge rank="admin" />
        <StaffBadge rank="owner" />
        <StaffBadge rank="mod" />
      </>,
    );
    expect(screen.getAllByText("Admin")).toHaveLength(1);
    expect(screen.getAllByText("Owner")).toHaveLength(1);
    expect(screen.getAllByText("Mod")).toHaveLength(1);
  });
});

describe("the badges on a profile", () => {
  it("say what they mean when pointed at", () => {
    vi.useFakeTimers();
    try {
      render(
        <>
          <StaffBadge rank="owner" />
          <StaffBadge rank="developer" />
        </>,
      );
      fireEvent.mouseEnter(screen.getByTestId("owner-badge").parentElement!);
      act(() => void vi.advanceTimersByTime(400));
      expect(screen.getByRole("tooltip").textContent).toBe("Owner of Nexa");
      fireEvent.mouseLeave(screen.getByTestId("owner-badge").parentElement!);
      fireEvent.mouseEnter(screen.getByTestId("developer-badge").parentElement!);
      act(() => void vi.advanceTimersByTime(400));
      expect(screen.getByRole("tooltip").textContent).toBe("Developer of Nexa");
    } finally {
      vi.useRealTimers();
    }
  });
});
