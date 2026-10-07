// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, onLocaleChange, translator } from "./index";

afterEach(cleanup);

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("a change of language", () => {
  it("is told once the new language's words are here, and not for the first one", async () => {
    const told: { locale: string; drawnIn: string }[] = [];
    const stop = onLocaleChange((locale) => told.push({ locale, drawnIn: translator().locale }));
    const view = render(<I18nProvider locale="en">x</I18nProvider>);
    await new Promise((r) => setTimeout(r, 20));
    expect(told).toEqual([]);
    view.rerender(<I18nProvider locale="de">x</I18nProvider>);
    await until(() => told.length > 0);
    expect(told).toEqual([{ locale: "de", drawnIn: "de" }]);
    view.rerender(<I18nProvider locale="en">x</I18nProvider>);
    await until(() => told.length > 1);
    stop();
    view.rerender(<I18nProvider locale="fr">x</I18nProvider>);
    await new Promise((r) => setTimeout(r, 50));
    expect(told.map((x) => x.locale)).toEqual(["de", "en"]);
  });
});
