// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEmoji } from "@/components/pickers/emojiIndex";
import { useExpressions } from "@/stores/expressions";
// the picker itself is tested on its own; here it only has to open by the button
vi.mock("@/components/pickers/ExpressionPicker", () => ({
  ExpressionPicker: ({ anchor }: { anchor?: DOMRect | null }) => <div data-testid="picker" data-anchored={!!anchor} />,
}));

import { AboutMeEditor, aboutToEdit, aboutToSave } from "./AboutMeEditor";

const blob = { id: "1", server_id: "9", name: "partyblob", blob_id: "4242", animated: false, creator_id: "2", created_at: 0 };

beforeAll(async () => {
  // without the list of drawn pictures every emoji counts as drawn
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  await loadEmoji();
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  useExpressions.setState({ emojis: { "9": [blob] } });
});

afterEach(() => {
  cleanup();
  useExpressions.setState({ emojis: {} });
});

function Editor({ start = "" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return <AboutMeEditor value={value} onChange={setValue} max={1000} placeholder="Tell people about yourself" label="About Me" />;
}

describe("an About Me's custom emoji", () => {
  it("are saved as the emoji and written as their :name:", () => {
    expect(aboutToSave("hi :partyblob: there")).toBe("hi <:partyblob:4242> there");
    expect(aboutToEdit("hi <:partyblob:4242> there")).toBe("hi :partyblob: there");
  });

  it("leave @names as words, which a profile has nobody to point at with", () => {
    expect(aboutToSave("ask @nora")).toBe("ask @nora");
  });

  it("stay as they are when their name would not bring them back", () => {
    expect(aboutToEdit("<:gone:777>")).toBe("<:gone:777>");
  });
});

describe("AboutMeEditor", () => {
  it("wraps the selection in bold with Ctrl+B, as the message box does", () => {
    render(<Editor start="hello" />);
    const box = screen.getByLabelText("About Me") as HTMLTextAreaElement;
    box.setSelectionRange(0, 5);
    fireEvent.keyDown(box, { key: "b", ctrlKey: true });
    expect(box.value).toBe("**hello**");
  });

  it("turns a :name: into its emoji as the closing colon goes in", () => {
    render(<Editor />);
    const box = screen.getByLabelText("About Me") as HTMLTextAreaElement;
    // as typing does it, past React's own record of the value
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "so sad :sob:");
    box.setSelectionRange(box.value.length, box.value.length);
    fireEvent(box, new InputEvent("input", { inputType: "insertText", data: ":", bubbles: true }));
    expect(box.value).toBe("so sad \u{1F62D}");
  });

  it("offers formatting in the right-click menu and has the message box's buttons", () => {
    render(<Editor />);
    expect(screen.getByLabelText("About Me").hasAttribute("data-markdown")).toBe(true);
    expect(screen.getByTestId("about-format-open")).toBeTruthy();
    expect(screen.getByTestId("about-emoji-open")).toBeTruthy();
  });

  it("opens the emoji picker by its button", () => {
    render(<Editor />);
    fireEvent.click(screen.getByTestId("about-emoji-open"));
    expect(screen.getByTestId("picker").getAttribute("data-anchored")).toBe("true");
  });
});
