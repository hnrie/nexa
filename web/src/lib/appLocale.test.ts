// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { useAppLocale } from "./appLocale";

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
});

describe("the language the app is drawn in", () => {
  it("stays the account's own while its settings are put away: the lock screen, a reload, signing out", () => {
    const { result } = renderHook(() => useAppLocale());
    expect(result.current).toBeNull();
    // the account's settings arrive, in Arabic
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, locale: "ar" }, loaded: true }));
    expect(result.current).toBe("ar");
    // the app locks: the settings are forgotten, the language is not
    act(() => useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false }));
    expect(result.current).toBe("ar");
  });

  it("follows the browser again once the account says so", () => {
    const { result } = renderHook(() => useAppLocale());
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, locale: "de" }, loaded: true }));
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, locale: null }, loaded: true }));
    act(() => useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false }));
    expect(result.current).toBeNull();
  });
});
