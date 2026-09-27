// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
