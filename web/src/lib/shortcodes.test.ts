import { mightHaveShortcode } from "./shortcodes";

describe("whether a message could hold a :shortcode:", () => {
  it("says yes for a name between colons", () => {
    expect(mightHaveShortcode("that was :joy: honestly")).toBe(true);
    expect(mightHaveShortcode(":+1:")).toBe(true);
    expect(mightHaveShortcode(":woman_technologist:")).toBe(true);
  });

  it("says no for the colons every link, time and reply has", () => {
    // these used to fetch both name tables for the first page of almost any channel
    expect(mightHaveShortcode("https://example.com:8080/path")).toBe(false);
    expect(mightHaveShortcode("see you at 12:30")).toBe(false);
    expect(mightHaveShortcode("re: the plan")).toBe(false);
    expect(mightHaveShortcode("note: one: two")).toBe(false);
    expect(mightHaveShortcode("no colons at all")).toBe(false);
  });
});
