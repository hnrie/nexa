// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeUser } from "@/api/types";
import { useAuth } from "@/stores/auth";
import AccountPage from "./AccountPage";

const me = { id: "1", username: "alice", display_name: "Alice", avatar_id: null, banner_id: null, accent_color: null, has_recovery: true } as unknown as MeUser;

beforeEach(() => {
  useAuth.setState({ me, newRecoveryKey: vi.fn().mockResolvedValue("AAAAAAAA-BBBBBBBB") });
});
afterEach(cleanup);

async function generateKey() {
  render(<AccountPage onEditProfile={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /new recovery key/i }));
  fireEvent.change(screen.getByLabelText(/password/i, { selector: "input" }), { target: { value: "hunter22" } });
  // Enter in the password box generates, as the button does
  fireEvent.keyDown(screen.getByLabelText(/password/i, { selector: "input" }), { key: "Enter" });
  await waitFor(() => expect(screen.getByTestId("recovery-key")).toBeTruthy());
}

describe("AccountPage's new recovery key", () => {
  it("cannot be put away by Escape or a close button once it is on screen", async () => {
    await generateKey();
    // the old key is already dead: losing this one would leave no way back in
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("recovery-key")).toBeTruthy();
  });

  it("goes only once the person says it is saved", async () => {
    await generateKey();
    const done = screen.getByTestId("recovery-done") as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("recovery-saved"));
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    expect(screen.queryByTestId("recovery-key")).toBeNull();
  });
});
