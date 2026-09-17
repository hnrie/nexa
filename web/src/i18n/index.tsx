/**
 * Translation, as the app uses it.
 *
 * `useT()` gives a component its translator; `t("key", {…})` is a string and
 * `<Tr id="key" values={{…}} />` is the same thing when a value is a piece of
 * the interface rather than text — a name in bold, a link.
 *
 * Only English is in the bundle. A language is fetched the first time it is
 * chosen and kept, so nobody downloads ten catalogues to read one.
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "./locales/en.json";
import {
  LANGUAGES,
  LANGUAGE_TAGS,
  Translator,
  interpolate,
  languageInfo,
  pickLanguage,
  pluralForm,
  type Catalog,
  type Values,
} from "./core";

export { LANGUAGES, LANGUAGE_TAGS, languageInfo, pickLanguage } from "./core";
export type { LanguageInfo } from "./core";

const english = en as Catalog;
const loaded = new Map<string, Catalog>([["en", english]]);
const loading = new Map<string, Promise<Catalog>>();

/** The catalogues, split out of the bundle so only what is used is fetched. */
const files = import.meta.glob<{ default: Catalog }>("./locales/*.json");

export async function loadCatalog(tag: string): Promise<Catalog> {
  const have = loaded.get(tag);
  if (have) return have;
  const already = loading.get(tag);
  if (already) return already;
  const load = files[`./locales/${tag}.json`];
  if (!load) return english;
  const p = load()
    .then((m) => {
      const c = m.default;
      loaded.set(tag, c);
      loading.delete(tag);
      return c;
    })
    .catch(() => {
      loading.delete(tag);
      return english;
    });
  loading.set(tag, p);
  return p;
}

/**
 * The translator in use, held here rather than only in a context.
 *
 * Text is not only written in components: a toast, an error a store throws, a
 * label a helper builds. A module-level translator means `t()` reads the same
 * way everywhere, with no component having to thread it through. Changing
 * language re-renders the whole tree (the provider keys on the tag), so
 * nothing is left holding an old string.
 */
let current = new Translator("en", english, english);

/** A translated string, anywhere in the app. */
export function t(key: string, values?: Values & { count?: number }): string {
  return current.t(key, values);
}

/** The translator itself, for code that needs the locale or the raw message. */
export function translator(): Translator {
  return current;
}

interface Ctx {
  tr: Translator;
  setLocale: (tag: string) => void;
}

const I18nContext = createContext<Ctx>({
  tr: current,
  setLocale: () => {},
});

/** What the browser asks for, so a first visit is already in the right language. */
export function browserLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  return pickLanguage(list.filter(Boolean));
}

export function I18nProvider({ locale, children }: { locale?: string | null; children: ReactNode }) {
  const [tag, setTag] = useState(() => (locale && LANGUAGE_TAGS.includes(locale) ? locale : browserLanguage()));
  const [catalog, setCatalog] = useState<Catalog>(() => loaded.get(tag) ?? english);
  // A catalogue is fetched, so the first render after picking a language is
  // still English. Counting the catalogues that have arrived gives the tree
  // below a key that changes when one does, which is what makes a memoised
  // piece of interface — a channel's empty state, a menu built once — pick up
  // the new words instead of holding the English it was born with.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const want = locale && LANGUAGE_TAGS.includes(locale) ? locale : browserLanguage();
    if (want !== tag) setTag(want);
  }, [locale, tag]);

  useEffect(() => {
    let alive = true;
    void loadCatalog(tag).then((c) => {
      if (!alive) return;
      setCatalog((was) => {
        if (was !== c) setEpoch((n) => n + 1);
        return c;
      });
    });
    return () => {
      alive = false;
    };
  }, [tag]);

  // the document itself has to say which language it is in and which way it reads
  useEffect(() => {
    if (typeof document === "undefined") return;
    const info = languageInfo(tag);
    document.documentElement.lang = tag;
    document.documentElement.dir = info?.rtl ? "rtl" : "ltr";
  }, [tag]);

  const value = useMemo<Ctx>(() => {
    const tr = new Translator(tag, catalog, english);
    current = tr;
    return { tr, setLocale: setTag };
  }, [tag, catalog]);
  // keyed on the language and on the catalogue behind it, so every string is
  // built again when either changes
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={`${tag}:${epoch}`}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

export function useI18n(): Ctx {
  return useContext(I18nContext);
}

/** The translator function for a component. */
export function useT(): (key: string, values?: Values & { count?: number }) => string {
  const { tr } = useI18n();
  return useCallback((key: string, values?: Values & { count?: number }) => tr.t(key, values), [tr]);
}

/** The current language tag, for anything that formats by locale. */
export function useLocale(): string {
  return useI18n().tr.locale;
}

/**
 * A translated string with pieces of the interface in it: `<Tr id="invited.by"
 * values={{ name: <b>Ana</b> }} />`. The string still decides the order, which
 * is the whole point — a language may want the name last.
 */
export function Tr({ id, values }: { id: string; values?: Values & { count?: number } }) {
  const { tr } = useI18n();
  const message = tr.message(id);
  if (message === undefined) return <>{id}</>;
  const template = typeof message === "string" ? message : pluralForm(message, Number(values?.count ?? 0), tr.locale);
  if (!values) return <>{template}</>;
  const nodes: ReactNode[] = [];
  let at = 0;
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m.index > at) nodes.push(template.slice(at, m.index));
    const name = m[1]!;
    const v = values[name];
    if (v === undefined) nodes.push(m[0]);
    else if (typeof v === "number") nodes.push(interpolate("{n}", { n: v }, tr.locale));
    else nodes.push(v as ReactNode);
    at = m.index + m[0].length;
  }
  if (at < template.length) nodes.push(template.slice(at));
  return <>{nodes.map((n, i) => <span key={i} style={{ display: "contents" }}>{n}</span>)}</>;
}
