/**
 * Translation.
 *
 * Every piece of text people read is a key here with an English source string,
 * and each language is a file of the same keys. A key with no translation
 * falls back to English rather than showing the key, so a half-finished
 * language reads as mixed rather than broken.
 *
 * The rules a real translation needs and a plain lookup table does not:
 *
 * - **Plurals.** "1 member" and "2 members" is English's two-form rule; Russian
 *   has three, Arabic six, Japanese one. Each string that counts something
 *   carries the forms its language uses, chosen by Intl.PluralRules.
 * - **Order.** "%(name)s sent %(count)s files" has to be able to put the count
 *   first, so values go in by name, never by position.
 * - **Direction.** Arabic and Hebrew read right to left, which is a document
 *   attribute, not a string.
 */

import type { ReactNode } from "react";

/** A translated string, or the forms of a string that counts something. */
export type Message = string | PluralForms;

/** The plural forms a language uses, keyed by Intl's categories. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Catalog = Record<string, Message>;

export interface LanguageInfo {
  /** BCP 47 tag, as Intl and the `lang` attribute want it. */
  tag: string;
  /** What the language calls itself, which is what a picker should show. */
  endonym: string;
  /** English name, for anyone who cannot read the endonym. */
  english: string;
  rtl?: boolean;
}

/** Every language the app ships, English first. */
export const LANGUAGES: LanguageInfo[] = [
  { tag: "en", endonym: "English", english: "English" },
  { tag: "es", endonym: "Español", english: "Spanish" },
  { tag: "fr", endonym: "Français", english: "French" },
  { tag: "de", endonym: "Deutsch", english: "German" },
  { tag: "sv", endonym: "Svenska", english: "Swedish" },
  { tag: "pt-BR", endonym: "Português (Brasil)", english: "Portuguese (Brazil)" },
  { tag: "ru", endonym: "Русский", english: "Russian" },
  { tag: "ja", endonym: "日本語", english: "Japanese" },
  { tag: "ko", endonym: "한국어", english: "Korean" },
  { tag: "zh-CN", endonym: "简体中文", english: "Chinese (Simplified)" },
  { tag: "hi", endonym: "हिन्दी", english: "Hindi" },
  { tag: "ar", endonym: "العربية", english: "Arabic", rtl: true },
];

export const LANGUAGE_TAGS = LANGUAGES.map((l) => l.tag);

export function languageInfo(tag: string): LanguageInfo | undefined {
  return LANGUAGES.find((l) => l.tag === tag);
}

/**
 * The best language for a list of preferences: an exact match first, then the
 * base language ("pt" for "pt-PT"), then English.
 */
export function pickLanguage(preferred: readonly string[]): string {
  for (const want of preferred) {
    const tag = want.trim();
    if (!tag) continue;
    const exact = LANGUAGE_TAGS.find((t) => t.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = tag.split("-")[0]!.toLowerCase();
    const loose = LANGUAGE_TAGS.find((t) => t.toLowerCase() === base || t.toLowerCase().startsWith(base + "-"));
    if (loose) return loose;
  }
  return "en";
}

/** Values a string can carry. Numbers are formatted for the language. */
export type Values = Record<string, string | number | ReactNode>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Whether a message is the plural kind. */
function isPlural(m: Message): m is PluralForms {
  return typeof m === "object" && m !== null && "other" in m;
}

/**
 * Chooses the form for a count. Intl knows every language's rule; where a
 * language lacks the category a translator filled in, `other` stands in, which
 * is the one every language has.
 */
export function pluralForm(forms: PluralForms, count: number, locale: string): string {
  let category: Intl.LDMLPluralRule = "other";
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = count === 1 ? "one" : "other";
  }
  return forms[category] ?? forms.other;
}

/** Fills {name} placeholders in, formatting numbers for the language. */
export function interpolate(template: string, values: Values | undefined, locale: string): string {
  if (!values) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (!(name in values)) return whole;
    const v = values[name];
    if (typeof v === "number") return formatNumber(v, locale);
    if (typeof v === "string") return v;
    // a node cannot go into a plain string; the caller wants tr() for that
    return whole;
  });
}

export function formatNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

/** One language's strings, with English behind it. */
export class Translator {
  constructor(
    readonly locale: string,
    private readonly catalog: Catalog,
    private readonly fallback: Catalog,
  ) {}

  get rtl(): boolean {
    return languageInfo(this.locale)?.rtl === true;
  }

  /** The source string for a key, in this language or English. */
  message(key: string): Message | undefined {
    return this.catalog[key] ?? this.fallback[key];
  }

  /**
   * A translated string. `count` picks the plural form and is also available
   * as {count}; anything else in `values` fills its own placeholder.
   */
  t(key: string, values?: Values & { count?: number }): string {
    const m = this.message(key);
    if (m === undefined) return key;
    const template = isPlural(m) ? pluralForm(m, Number(values?.count ?? 0), this.locale) : m;
    return interpolate(template, values, this.locale);
  }

  /** Whether a key exists at all, for tests and tooling. */
  has(key: string): boolean {
    return this.message(key) !== undefined;
  }
}
