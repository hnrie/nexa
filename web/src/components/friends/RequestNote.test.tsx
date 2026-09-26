// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { generateIdentity } from "@/crypto/keys";
import { sealRequestNote } from "@/lib/requestNote";
import { useKeys } from "@/stores/keys";
import { RequestNote } from "./RequestNote";

const me = generateIdentity();

afterEach(() => {
  cleanup();
  useKeys.getState().reset();
});

describe("an incoming request's note", () => {
  it("is opened with this account's key and shown as text, never as markup", async () => {
    useKeys.setState({ userId: "me", identity: me });
    const note = "<b>Hi</b>, it's Sam <img src=x onerror=alert(1)>";
    render(<RequestNote sealed={await sealRequestNote(me.publicKey, note)} />);
    const shown = await screen.findByTestId("friend-request-note");
    expect(shown.textContent).toBe(note);
    expect(shown.getAttribute("title")).toBe(note);
    expect(shown.getAttribute("dir")).toBe("auto");
    expect(shown.querySelector("b, img")).toBeNull();
  });

  it("shows nothing for a note sealed to someone else", async () => {
    useKeys.setState({ userId: "me", identity: me });
    const { container } = render(<RequestNote sealed={await sealRequestNote(generateIdentity().publicKey, "not for you")} />);
    // give the opening a moment to fail
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe("");
  });

  it("shows nothing while the keys are locked away", async () => {
    const sealed = await sealRequestNote(me.publicKey, "later");
    const { container } = render(<RequestNote sealed={sealed} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe("");
  });
});
