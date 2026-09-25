// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import RegisterPage from "./RegisterPage";

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

function fillAll(container: HTMLElement, username: string, password = "correct horse battery", confirm = password) {
  fireEvent.change(container.querySelector("input[autocomplete=username]")!, { target: { value: username } });
  fireEvent.change(container.querySelector("input[autocomplete=nickname]")!, { target: { value: "Mara" } });
  const [pw, again] = container.querySelectorAll("input[type=password]");
  fireEvent.change(pw!, { target: { value: password } });
  fireEvent.change(again!, { target: { value: confirm } });
}

describe("RegisterPage", () => {
  it("says a taken username on the username field and focuses it", async () => {
    useAuth.setState({ status: "anonymous", register: () => Promise.reject(new ApiError(409, "username_taken", "taken")) });
    const { container } = renderPage();
    fillAll(container, "mara");
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    const username = container.querySelector("input[autocomplete=username]")!;
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/taken/i);
    expect(alert.closest("label")?.contains(username)).toBe(true);
    expect(document.activeElement).toBe(username);
    fireEvent.change(username, { target: { value: "mara2" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("answers Enter on an unfinished form by going to what is wrong", async () => {
    let called = false;
    useAuth.setState({ status: "anonymous", register: async () => { called = true; return { recoveryKey: "X" }; } });
    const { container } = renderPage();
    fillAll(container, "mara", "correct horse battery", "correct horse batter");
    const submit = container.querySelector("button[type=submit]") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(called).toBe(false);
    expect(document.activeElement).toBe(container.querySelectorAll("input[type=password]")[1]);
  });

  it("keeps the strength meter in place from the start, so typing moves nothing", () => {
    useAuth.setState({ status: "anonymous" });
    const { container } = renderPage();
    const pw = container.querySelector("input[type=password]")!;
    const meter = document.getElementById(pw.getAttribute("aria-describedby") ?? "");
    expect(meter).not.toBeNull();
    fireEvent.change(pw, { target: { value: "abc" } });
    expect(document.getElementById(pw.getAttribute("aria-describedby") ?? "")).toBe(meter);
  });
});
