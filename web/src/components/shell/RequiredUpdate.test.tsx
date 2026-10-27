// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequiredUpdate } from "./RequiredUpdate";

const updates = vi.hoisted(() => ({
  getState: vi.fn(async () => ({ status: "ready", version: "1.2.8" })),
  onState: vi.fn(() => () => undefined), check: vi.fn(async () => undefined), restart: vi.fn(),
}));
vi.mock("@/lib/desktopBridge", () => ({ desktopBridge: () => ({ updates }) }));
afterEach(() => vi.restoreAllMocks());
describe("required manual desktop transition", () => {
  it("offers only the installer even if the old unsigned updater has staged an update", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<RequiredUpdate need={{ running: "1.2.7", version: "1.2.8", url: "https://nexa.test/desktop/new.exe", manual: true }} />);
    expect(screen.queryByTestId("required-update-restart")).toBeNull();
    expect(screen.queryByTestId("required-update-check")).toBeNull();
    expect(updates.getState).not.toHaveBeenCalled();
    expect(updates.check).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("required-update-download"));
    expect(open).toHaveBeenCalledWith("https://nexa.test/desktop/new.exe", "_blank", "noopener,noreferrer");
    expect(updates.restart).not.toHaveBeenCalled();
  });
});
