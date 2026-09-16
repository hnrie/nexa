import { describe, expect, it } from "vitest";
import { interpolate, pickLanguage, pluralForm, Translator, type Catalog } from "./core";

const en: Catalog = {
  hello: "Hello",
  greet: "Hello, {name}",
  members: { one: "{count} member", other: "{count} members" },
  sent: "{name} sent {count} files",
};

describe("pickLanguage", () => {
  it("takes an exact tag first", () => {
    expect(pickLanguage(["pt-BR", "en"])).toBe("pt-BR");
    expect(pickLanguage(["zh-CN"])).toBe("zh-CN");
  });

  it("falls back to the base language", () => {
    expect(pickLanguage(["pt-PT"])).toBe("pt-BR");
    expect(pickLanguage(["es-MX", "fr"])).toBe("es");
    expect(pickLanguage(["zh-Hans-CN"])).toBe("zh-CN");
  });

  it("ends at English rather than nothing", () => {
    expect(pickLanguage(["cy", "gd"])).toBe("en");
    expect(pickLanguage([])).toBe("en");
    expect(pickLanguage([""])).toBe("en");
  });
});

describe("interpolate", () => {
  it("fills placeholders by name, so a language can reorder them", () => {
    expect(interpolate("{a} then {b}", { a: "one", b: "two" }, "en")).toBe("one then two");
    expect(interpolate("{b} before {a}", { a: "one", b: "two" }, "en")).toBe("two before one");
  });

  it("leaves a placeholder alone when nothing was given for it", () => {
    expect(interpolate("hi {name}", {}, "en")).toBe("hi {name}");
  });

  it("formats numbers for the language", () => {
    expect(interpolate("{n}", { n: 1234567 }, "en")).toBe("1,234,567");
    expect(interpolate("{n}", { n: 1234567 }, "de")).toBe("1.234.567");
  });
});

describe("plurals", () => {
  it("uses English's two forms", () => {
    const forms = { one: "{count} file", other: "{count} files" };
    expect(pluralForm(forms, 1, "en")).toBe("{count} file");
    expect(pluralForm(forms, 0, "en")).toBe("{count} files");
    expect(pluralForm(forms, 2, "en")).toBe("{count} files");
  });

  it("uses Russian's three", () => {
    const forms = { one: "файл", few: "файла", many: "файлов", other: "файла" };
    expect(pluralForm(forms, 1, "ru")).toBe("файл");
    expect(pluralForm(forms, 3, "ru")).toBe("файла");
    expect(pluralForm(forms, 11, "ru")).toBe("файлов");
  });

  it("uses Japanese's one", () => {
    const forms = { other: "{count} 件" };
    expect(pluralForm(forms, 1, "ja")).toBe("{count} 件");
    expect(pluralForm(forms, 9, "ja")).toBe("{count} 件");
  });

  it("stands in `other` for a form the translator left out", () => {
    expect(pluralForm({ other: "x" }, 1, "en")).toBe("x");
  });
});

describe("Translator", () => {
  it("prefers the language and falls back to English rather than the key", () => {
    const t = new Translator("es", { hello: "Hola" }, en);
    expect(t.t("hello")).toBe("Hola");
    expect(t.t("greet", { name: "Ana" })).toBe("Hello, Ana");
  });

  it("returns the key only when neither has it, so nothing vanishes", () => {
    const t = new Translator("es", {}, en);
    expect(t.t("nothing.here")).toBe("nothing.here");
  });

  it("counts and fills in one go", () => {
    const t = new Translator("en", {}, en);
    expect(t.t("members", { count: 1 })).toBe("1 member");
    expect(t.t("members", { count: 5 })).toBe("5 members");
    expect(t.t("sent", { name: "Ana", count: 3 })).toBe("Ana sent 3 files");
  });

  it("knows which languages read right to left", () => {
    expect(new Translator("ar", {}, en).rtl).toBe(true);
    expect(new Translator("en", {}, en).rtl).toBe(false);
  });
});
