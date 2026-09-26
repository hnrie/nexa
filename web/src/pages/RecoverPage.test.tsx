// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startSession } from "@/gateway/session";
import { AppRoutes } from "@/routes";
import { useAuth } from "@/stores/auth";
import RecoverPage from "./RecoverPage";

// Landing in the app would open the gateway; these tests only need to know it did not.
vi.mock("@/gateway/session", () => ({ startSession: vi.fn(), stopSession: vi.fn() }));

afterEach(cleanup);

function fill(inputs: NodeListOf<HTMLInputElement>, values: string[]) {
  values.forEach((v, i) => fireEvent.change(inputs[i]!, { target: { value: v } }));
}

describe("RecoverPage", () => {
  it("shows the new recovery key even though recovering has already logged in", async () => {
    useAuth.setState({
      status: "anonymous",
      // like the real thing, the session is ready before the new key comes back
      recover: async () => {
        useAuth.setState({ status: "ready" });
        await Promise.resolve();
        return { recoveryKey: "NEW-KEY-1234" };
      },
    });
    // the real routes, since wrapping /recover in a redirect is what hid the key
    const { container } = render(
      <MemoryRouter initialEntries={["/recover"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByText("Recover Your Account");
    fill(container.querySelectorAll("input"), ["mara", "0".repeat(64), "new password 1", "new password 1"]);
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(screen.getByText("NEW-KEY-1234")).toBeTruthy();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("still sends someone already logged in to the app", () => {
    useAuth.setState({ status: "ready" });
    render(
      <MemoryRouter initialEntries={["/recover"]}>
        <Routes>
          <Route path="/recover" element={<RecoverPage />} />
          <Route path="/channels/@me" element={<div>the app</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
  });
});
