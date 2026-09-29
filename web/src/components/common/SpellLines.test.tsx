// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";

vi.mock("@/lib/spell", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/spell")>();
  return {
    ...real,
    misspelled: async (words: string[]) => new Set(words.filter((w) => w === "wrold")),
    knownWrong: (word: string) => word === "wrold",
  };
});

import { SpellLines } from "./SpellLines";

function Box({ text }: { text: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <textarea ref={ref} value={text} readOnly aria-label="box" />
      <SpellLines target={ref} text={text} />
    </div>
  );
}

const marked = () => [...(screen.queryByTestId("spell-lines")?.querySelectorAll("span") ?? [])].map((s) => s.textContent);

beforeAll(() => {
  // a computer with a mouse, and a browser with workers
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  (globalThis as { Worker?: unknown }).Worker ??= class {};
});

beforeEach(() => {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
});

afterEach(cleanup);

describe("SpellLines", () => {
  it("draws a line under each misspelled word and nothing else", async () => {
    render(<Box text="hello wrold, and wrold again" />);
    await act(async () => {});
    expect(marked()).toEqual(["wrold", "wrold"]);
  });

  it("waits for the word being typed to be finished", async () => {
    render(<Box text="hello wrold" />);
    await act(async () => {});
    const ta = screen.getByLabelText("box") as HTMLTextAreaElement;
    ta.setSelectionRange(11, 11);
    fireEvent(ta, new InputEvent("input", { inputType: "insertText", data: "d", bubbles: true }));
    expect(marked()).toEqual([]);
    fireEvent.blur(ta);
    expect(marked()).toEqual(["wrold"]);
  });

  it("draws nothing with spell check off", async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, spellcheck: false } });
    render(<Box text="hello wrold" />);
    await act(async () => {});
    expect(screen.queryByTestId("spell-lines")).toBeNull();
  });
});
