// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { MaintenanceBanner, maintenanceRemaining } from "./MaintenanceBanner";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("shows only the final 150 minutes, holds at zero for delayed reboots", () => {
 const schedule = { reboot_at: 10_000_000, now: 0, notice_ms: 9_000_000 };
 expect(maintenanceRemaining(schedule, 999_999)).toBeNull();
 expect(maintenanceRemaining(schedule, 1_000_000)).toBe(9000);
 expect(maintenanceRemaining(schedule, 10_000_001)).toBe(0);
 expect(maintenanceRemaining({ ...schedule, reboot_at: 0 }, 0)).toBeNull();
});
it("counts down without a dismiss control and removes a cancelled notice", async () => {
 vi.useFakeTimers();
 const request = vi.spyOn(api, "request").mockResolvedValue({ reboot_at: 10_000_000, now: 1_000_000, notice_ms: 9_000_000 });
 render(<MaintenanceBanner />);
 await act(async () => {});
 expect(screen.getByText("Server restarts in 2:30:00")).toBeTruthy();
 expect(screen.queryByRole("button")).toBeNull();
 await act(async () => { vi.advanceTimersByTime(1000); });
 expect(screen.getByText("Server restarts in 2:29:59")).toBeTruthy();
 request.mockResolvedValue({ reboot_at: 0, now: 1_030_000, notice_ms: 9_000_000 });
 await act(async () => { vi.advanceTimersByTime(30_000); });
 expect(screen.queryByTestId("maintenance-banner")).toBeNull();
});
