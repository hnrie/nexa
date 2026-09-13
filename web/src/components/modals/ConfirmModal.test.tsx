// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { useUI } from "@/stores/ui";
import { ConfirmModal } from "./ConfirmModal";

afterEach(() => {
  cleanup();
  useUI.setState({ toasts: [] });
});

describe("ConfirmModal", () => {
  it("says why the action failed and stays open to try again", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(403, "missing_permissions", "Missing permissions."));
    render(<ConfirmModal title="Delete Channel" body="Sure?" confirmLabel="Delete" onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(useUI.getState().toasts.map((t) => t.text)).toEqual(["Missing permissions."]));
    expect(onClose).not.toHaveBeenCalled();
    expect(useUI.getState().toasts[0]?.kind).toBe("error");
  });

  it("closes once the action succeeds", async () => {
    const onClose = vi.fn();
    render(<ConfirmModal title="Delete Channel" body="Sure?" confirmLabel="Delete" onClose={onClose} onConfirm={() => Promise.resolve()} />);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useUI.getState().toasts).toEqual([]);
  });
});
