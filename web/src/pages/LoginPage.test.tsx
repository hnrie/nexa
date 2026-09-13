// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useAuth } from "@/stores/auth";
import LoginPage from "./LoginPage";

afterEach(cleanup);

describe("LoginPage", () => {
  it("blames the connection, not the password, when the request never got an answer", async () => {
    useAuth.setState({
      status: "anonymous",
      login: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    const [username, password] = container.querySelectorAll("input");
    fireEvent.change(username!, { target: { value: "mara" } });
    fireEvent.change(password!, { target: { value: "correct horse" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/can't reach the server/i);
  });
});
