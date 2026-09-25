// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
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

  it("says a wrong password on the password field, where it moves nothing, until the password changes", async () => {
    useAuth.setState({
      status: "anonymous",
      login: () => Promise.reject(new ApiError(401, "invalid_credentials", "Invalid username or password")),
    });
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    const [username, password] = container.querySelectorAll("input");
    fireEvent.change(username!, { target: { value: "mara" } });
    fireEvent.change(password!, { target: { value: "not it" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/username or password is wrong/i);
    // on the field itself, not in a box above the form
    expect(alert.closest("label")?.contains(password!)).toBe(true);
    expect(password!.getAttribute("aria-invalid")).toBe("true");
    expect(username!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(password);
    fireEvent.change(password!, { target: { value: "not it either" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the forgotten-password link out of the password box's name", () => {
    useAuth.setState({ status: "anonymous" });
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    const password = container.querySelector("input[type=password]")!;
    const label = document.getElementById(password.getAttribute("aria-labelledby") ?? "");
    expect(label?.textContent).toMatch(/password/i);
    expect(label?.textContent).not.toMatch(/forgot/i);
  });
});
