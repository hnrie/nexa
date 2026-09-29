/// <reference lib="webworker" />
/**
 * The spell checker, away from the page so typing never waits on it: Hunspell
 * dictionaries for American and British English (a word either spells right
 * is right, so "colour" and "color" both pass), and the words the person has
 * added themselves.
 */
import nspell from "nspell";
import { rank } from "./rank";
// The affix rules are small and come inside this script. The word lists are
// half a megabyte each and are fetched from the site, which the page's
// content policy allows (it would refuse the data: address a small file is
// otherwise inlined as).
import enAff from "../../../node_modules/dictionary-en/index.aff?raw";
import enDic from "../../../node_modules/dictionary-en/index.dic?url";
import gbAff from "../../../node_modules/dictionary-en-gb/index.aff?raw";
import gbDic from "../../../node_modules/dictionary-en-gb/index.dic?url";

const DICTIONARIES = [
  { aff: enAff, dic: enDic },
  { aff: gbAff, dic: gbDic },
];

type Request =
  | { type: "load"; personal: string[] }
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string }
  | { type: "add"; words: string[] }
  | { type: "remove"; words: string[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let checkers: ReturnType<typeof nspell>[] = [];
const personal = new Set<string>();
let ready: Promise<void> = Promise.resolve();

async function load(): Promise<void> {
  const text = (url: string) => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  checkers = await Promise.all(DICTIONARIES.map(async (d) => nspell(d.aff, await text(d.dic))));
}

/** The dictionaries spell "don't" with a straight apostrophe; a phone or a Mac types a curly one. */
const straight = (word: string) => word.replace(/’/g, "'");

function correct(word: string): boolean {
  if (personal.has(word.toLowerCase())) return true;
  // with no dictionary there is nothing to say a word is wrong
  if (checkers.length === 0) return true;
  const w = straight(word);
  if (checkers.some((c) => c.correct(w))) return true;
  // the word lists spell "café" as "cafe": an accented spelling of a word they know is right too
  const plain = w.normalize("NFD").replace(/\p{M}/gu, "");
  return plain !== w && checkers.some((c) => c.correct(plain));
}

function suggest(word: string): string[] {
  const curly = word.includes("’");
  const found: string[] = [];
  for (const c of checkers) {
    for (const s of c.suggest(straight(word))) {
      const shown = curly ? s.replace(/'/g, "’") : s;
      if (!found.includes(shown)) found.push(shown);
    }
  }
  return rank(word, found).slice(0, 5);
}

scope.onmessage = (e: MessageEvent<Request>) => {
  const msg = e.data;
  if (msg.type === "load") {
    for (const w of msg.personal) personal.add(w.toLowerCase());
    ready = load().catch(() => {
      checkers = [];
    });
    return;
  }
  if (msg.type === "add") {
    for (const w of msg.words) personal.add(w.toLowerCase());
    return;
  }
  if (msg.type === "remove") {
    for (const w of msg.words) personal.delete(w.toLowerCase());
    return;
  }
  void ready.then(() => {
    if (msg.type === "check") scope.postMessage({ id: msg.id, wrong: msg.words.filter((w) => !correct(w)) });
    else scope.postMessage({ id: msg.id, words: correct(msg.word) ? [] : suggest(msg.word) });
  });
};
