// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminBadge, AdminTools, OwnerBadge } from "./OwnerBadge";

afterEach(cleanup);

describe("admin tools", () => {
  it("draws a hammer and a mirrored wrench as one labelled mark", () => {
    const { container } = render(<AdminTools size={16} />);
    const mark = screen.getByRole("img", { name: "Admin" });
    expect(mark.style.width).toBe("16px");
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    expect(icons[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(icons[1]!.getAttribute("class")).toContain("mirror");
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
