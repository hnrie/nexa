// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUnsaved } from "@/stores/unsaved";
import { SaveBar, SettingsLayer } from "./SettingsLayer";

/** A phone-width window, or a wide one: all the layer asks of matchMedia is the phone breakpoint. */
function viewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 767px"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Harness({ dirty = false, startOnList = true }: { dirty?: boolean; startOnList?: boolean }) {
  const [page, setPage] = useState("alpha");
  return (
    <SettingsLayer label="Things" groups={[{ head: "Group", items: [{ id: "alpha", label: "Alpha" }, { id: "beta", label: "Beta" }] }]} page={page} setPage={setPage} onClose={() => {}} startOnList={startOnList}>
      <p>on page {page}</p>
      <SaveBar dirty={dirty} busy={false} onReset={() => {}} onSave={() => {}} />
    </SettingsLayer>
  );
}

beforeEach(() => useUnsaved.setState({ holds: 0, nudge: 0 }));
afterEach(cleanup);

describe("SettingsLayer on a phone", () => {
  it("opens on the list, opens a page from it, and goes back to it", () => {
    viewport(true);
    render(<Harness />);
    expect(screen.queryByText(/on page/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByText("on page beta")).toBeTruthy();
    // the list has made way for the page
    expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back to Things/ }));
    expect(screen.queryByText(/on page/)).toBeNull();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
  });

  it("opens straight at a page it was asked for, with the way back", () => {
    viewport(true);
    render(<Harness startOnList={false} />);
    expect(screen.getByText("on page alpha")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to Things/ })).toBeTruthy();
  });

  it("will not go back to the list over unsaved changes, and shakes the save bar instead", () => {
    viewport(true);
    render(<Harness dirty startOnList={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to Things/ }));
    expect(screen.getByText("on page alpha")).toBeTruthy();
    expect(useUnsaved.getState().nudge).toBe(1);
  });
});

describe("SettingsLayer on a wide screen", () => {
  it("shows the nav beside the page, with the open page marked", () => {
    viewport(false);
    render(<Harness />);
    expect(screen.getByText("on page alpha")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: /Back to Things/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByText("on page beta")).toBeTruthy();
  });
});
