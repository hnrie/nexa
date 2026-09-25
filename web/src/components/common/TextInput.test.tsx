// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, TextInput } from "./TextInput";

afterEach(cleanup);

describe("Field", () => {
  it("keeps the input's name out of the validation message", () => {
    const { rerender } = render(
      <Field label="Server name" required>
        <TextInput data-testid="name" />
      </Field>,
    );
    const input = screen.getByTestId("name");
    const nameFrom = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent;
    expect(nameFrom(input)).toBe("Server name *");
    expect(input.getAttribute("aria-invalid")).toBeNull();

    rerender(
      <Field label="Server name" required error="Name is taken">
        <TextInput data-testid="name" />
      </Field>,
    );
    // the name has not moved; the error arrives as a description
    expect(nameFrom(screen.getByTestId("name"))).toBe("Server name *");
    const describedBy = screen.getByTestId("name").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain("Name is taken");
    expect(screen.getByTestId("name").getAttribute("aria-invalid")).toBe("true");
    // and it is said out loud rather than only turning red
    expect(screen.getByRole("alert").textContent).toContain("Name is taken");
  });

  it("describes an input by its hint when there is no error", () => {
    render(
      <Field label="Slow mode" hint="Seconds between messages">
        <TextInput data-testid="slow" />
      </Field>,
    );
    const by = screen.getByTestId("slow").getAttribute("aria-describedby");
    expect(document.getElementById(by!)?.textContent).toBe("Seconds between messages");
  });

  it("names a group of radios without pretending to be one of them", () => {
    render(
      <Field as="div" label="Channel type">
        <div role="radiogroup" aria-label="Channel type">
          <input type="radio" name="t" aria-label="Text" />
        </div>
      </Field>,
    );
    const group = screen.getByRole("group", { name: "Channel type" });
    expect(group.tagName).toBe("DIV");
    // a wrapper that is not a control must not be given a name of its own
    expect(group.querySelector("div[aria-labelledby]")).toBeNull();
  });

  it("leaves a wrapper element alone rather than labelling a generic div", () => {
    render(
      <Field label="Invite link">
        <div data-testid="row">
          <TextInput readOnly />
          <button>Copy</button>
        </div>
      </Field>,
    );
    expect(screen.getByTestId("row").getAttribute("aria-labelledby")).toBeNull();
  });
});

describe("TextInput with reveal", () => {
  it("shows and hides a password, keeping the field's name and error on the input", () => {
    render(
      <Field label="Password" error="Wrong">
        <TextInput type="password" reveal defaultValue="hunter22" />
      </Field>,
    );
    const input = screen.getByLabelText("Password", { selector: "input" }) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
  });
});
