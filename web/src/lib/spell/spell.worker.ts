/// <reference lib="webworker" />
/**
 * The spell checker, away from the page so typing never waits on it: Hunspell
 * dictionaries for American and British English (a word either spells right
 * is right, so "colour" and "color" both pass), and the words the person has
 * added themselves.
 */
import { type Speller, speller } from "./checker";
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
let spell: Speller | null = null;
const personal = new Set<string>();
let ready: Promise<void> = Promise.resolve();

async function load(): Promise<void> {
  const text = (url: string) => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  spell = speller(await Promise.all(DICTIONARIES.map(async (d) => ({ aff: d.aff, dic: await text(d.dic) }))), personal);
}

scope.onmessage = (e: MessageEvent<Request>) => {
  const msg = e.data;
  if (msg.type === "load") {
    for (const w of msg.personal) personal.add(w.toLowerCase());
    ready = load().catch(() => {
      spell = null;
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
    // with no dictionary there is nothing to say a word is wrong
    const s = spell;
    if (msg.type === "check") scope.postMessage({ id: msg.id, wrong: s ? msg.words.filter((w) => !s.correct(w)) : [] });
    else scope.postMessage({ id: msg.id, words: s && !s.correct(msg.word) ? s.suggest(msg.word) : [] });
  });
};
