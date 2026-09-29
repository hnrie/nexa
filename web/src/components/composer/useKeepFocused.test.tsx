// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeepFocused } from "./Composer";

function Box({ enabled, label }: { enabled: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useKeepFocused(ref, enabled);
  return <textarea ref={ref} aria-label={label} />;
}

beforeEach(() => {
  // a mouse and a keyboard: the only case where the box keeps the caret
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("pointer: fine"), addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useKeepFocused", () => {
  it("leaves Space, Enter and Backspace to the button that has focus", () => {
    render(
      <>
        <button>Mute</button>
        <Box enabled label="Message" />
      </>,
    );
    const button = screen.getByRole("button");
    button.focus();
    for (const key of [" ", "Enter", "Backspace"]) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(button);
    }
    // a letter is writing, and goes to the box
    fireEvent.keyDown(document.activeElement!, { key: "h" });
    expect(document.activeElement).toBe(screen.getByLabelText("Message"));
  });

  it("takes the caret only into the box of the pane in focus", () => {
    render(
      <>
        <button>Somewhere</button>
        <Box enabled label="Focused pane" />
        <Box enabled={false} label="Other pane" />
      </>,
    );
    screen.getByRole("button").focus();
    fireEvent.keyDown(document.activeElement!, { key: "a" });
    expect(document.activeElement).toBe(screen.getByLabelText("Focused pane"));
    screen.getByRole("button").focus();
    // (jsdom has no PointerEvent; a mouse event of that name carries the button)
    screen.getByRole("button").dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect(document.activeElement).toBe(screen.getByLabelText("Focused pane"));
  });

  it("leaves a selection of nothing but emoji where it is, to be copied", () => {
    render(
      <>
        <p data-testid="message">
          <span className="md-emoji-box">
            <img alt={"\u{1F525}"} src="/twemoji/1f525.svg" />
          </span>
        </p>
        <Box enabled label="Message" />
      </>,
    );
    const message = screen.getByTestId("message");
    const range = document.createRange();
    range.selectNodeContents(message);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    // the selection's own text has no alt text in it, which read as nothing selected
    expect(document.getSelection()!.toString()).toBe("");
    message.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect(document.activeElement).not.toBe(screen.getByLabelText("Message"));
  });
});
