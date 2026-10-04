/**
 * Spell checking done by Nexa rather than the browser, so a text box's own
 * right-click menu (lib/textMenu) can offer spellings: a web page never gets
 * to see the browser's. Hunspell's American and British English dictionaries
 * (a word either spells right is right), a word list of the way people chat,
 * and the words a person adds, kept with their account.
 *
 * It runs on a computer with a mouse and a keyboard, in English: a phone's
 * keyboard checks spelling better than any page can, and these dictionaries
 * would mark every word of another language wrong.
 */
import { translator } from "@/i18n";
import { useSettings } from "@/stores/settings";

/** How people chat, which no dictionary spells. */
const CHAT_WORDS = new Set(
  (
    "lol lmao lmfao rofl omg omfg idk idc imo imho tbh ngl btw fyi brb afk gg ggs ggwp irl jk smh fr rn nvm pls plz thx ty tysm np yw " +
    "ikr wdym wyd hbu hru wbu ig istg lowkey highkey bruh yall oki okie kk kinda sorta wanna gotta gonna dunno lemme gimme ya yea yep yup nah " +
    "hmm hmmm mhm uhh umm ooh aww awww haha hahaha hehe heh xd pfp dm dms gif gifs meme memes emoji emojis ofc ily ilysm gn gm ttyl lmk " +
    "tho thru ur vc pc tv ai vr dj uk eu gf ui ux api apis wifi fomo yolo sus pog poggers vibe vibes rizz stan simp nexa youtube tiktok twitch reddit github " +
    // contractions typed without their apostrophe, as nearly everyone does in chat
    "ok im ive dont didnt doesnt isnt wasnt arent werent couldnt shouldnt wouldnt havent hasnt hadnt mustnt neednt youre youve youll youd " +
    "theyre theyve theyll theyd weve thats whats wheres whos hows whys theres heres itll thatll wouldve couldve shouldve mustve mightve " +
    "whatre whered howd whod hes shes imma ima cmon " +
    // the internet's own words
    "livestream livestreams livestreamed livestreaming streamer streamers gamer gamers gameplay signup signups unfollow unfollowed " +
    "vlog vlogs vlogger laggy spammy config configs async frontend backend bluetooth youtuber youtubers iphone iphones spotify discord " +
    "screenshotted selfies hashtags subreddit subreddits emote emotes"
  ).split(" "),
);

/**
 * Stretches of a message that are not prose, to leave alone: code, links,
 * addresses, mentions, channels, custom emoji and :names:, and timestamps.
 */
const NOT_PROSE = /```[\s\S]*?(?:```|$)|`[^`\n]*`?|<[@#][!&]?\d+>|<a?:\w+:\d+>|<t:-?\d+(?::\w)?>|https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|[@#][\p{L}\p{N}_.-]+|:[a-z0-9_+-]+:/giu;
/** A word in the Latin script, apostrophes inside it included, not glued to digits or other scripts. */
const WORD = /(?<![\p{L}\p{N}_])\p{Script=Latin}(?:[\p{Script=Latin}\p{M}'’]*\p{Script=Latin})?(?![\p{L}\p{N}_])/gu;

export interface Word {
  word: string;
  start: number;
  end: number;
}

/**
 * The words of a text worth checking, and where each is. Left out: whatever
 * is not prose, single letters, words in capitals (TBH, HTML), words with a
 * capital inside (iPhone, JavaScript), and the chat words above.
 */
export function wordsOf(text: string): Word[] {
  // what is not prose is blanked out, keeping every other word where it was
  const prose = text.replace(NOT_PROSE, (m) => " ".repeat(m.length));
  const out: Word[] = [];
  for (const m of prose.matchAll(WORD)) {
    const word = m[0];
    if (word.length < 2) continue;
    if (word === word.toUpperCase()) continue;
    if (/\p{Lu}/u.test(word.slice(1))) continue;
    if (CHAT_WORDS.has(word.toLowerCase().replace(/’/g, "'"))) continue;
    out.push({ word, start: m.index, end: m.index + word.length });
  }
  return out;
}

/** Whether Nexa's own checker runs here: switched on, in English, with a mouse and a keyboard. */
export function spellActive(): boolean {
  if (typeof window === "undefined" || typeof Worker === "undefined") return false;
  if (useSettings.getState().settings.spellcheck === false) return false;
  if (!translator().locale.startsWith("en")) return false;
  return !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
}

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (reply: { wrong?: string[]; words?: string[] }) => void>();
/** Every word asked about, and whether it is spelled right. */
const verdicts = new Map<string, boolean>();
/** How many words' answers are kept. */
const VERDICTS_MAX = 5000;
const learnt = new Set<() => void>();

function boot(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<{ id: number; wrong?: string[]; words?: string[] }>) => {
    waiting.get(e.data.id)?.(e.data);
    waiting.delete(e.data.id);
  };
  w.postMessage({ type: "load", personal: useSettings.getState().settings.spellWords });
  worker = w;
  // the account's words arrive after the checker starts, and change on its other devices
  let known = new Set(useSettings.getState().settings.spellWords);
  useSettings.subscribe((st) => {
    const now = new Set(st.settings.spellWords);
    const added = [...now].filter((x) => !known.has(x));
    const removed = [...known].filter((x) => !now.has(x));
    known = now;
    if (!added.length && !removed.length) return;
    if (added.length) w.postMessage({ type: "add", words: added });
    if (removed.length) w.postMessage({ type: "remove", words: removed });
    const changed = new Set([...added, ...removed]);
    for (const x of [...verdicts.keys()]) if (changed.has(x.toLowerCase())) verdicts.delete(x);
    for (const fn of learnt) fn();
  });
  return w;
}

function ask(msg: { type: "check"; words: string[] } | { type: "suggest"; word: string }): Promise<{ wrong?: string[]; words?: string[] }> {
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    boot().postMessage({ ...msg, id });
  });
}

/** Which of these words are misspelled. Each word is asked about once; after that the answer is known here. */
export async function misspelled(words: string[]): Promise<Set<string>> {
  const fresh = [...new Set(words.filter((w) => !verdicts.has(w)))];
  if (fresh.length) {
    const wrong = new Set((await ask({ type: "check", words: fresh })).wrong ?? []);
    for (const w of fresh) verdicts.set(w, !wrong.has(w));
    // every word ever typed would otherwise stay; the oldest answers go first and are asked again if needed
    while (verdicts.size > VERDICTS_MAX) verdicts.delete(verdicts.keys().next().value as string);
  }
  return new Set(words.filter((w) => verdicts.get(w) === false));
}

/** Whether a word is already known to be misspelled; one not asked about yet is not. */
export function knownWrong(word: string): boolean {
  return verdicts.get(word) === false;
}

/** The likeliest spellings of a misspelled word; none for one spelled right. */
export async function suggestions(word: string): Promise<string[]> {
  return (await ask({ type: "suggest", word })).words ?? [];
}

/** Adds a word to the person's own dictionary, which their account keeps, and marks it right everywhere at once. */
export function learn(word: string): void {
  const lower = word.toLowerCase();
  for (const w of verdicts.keys()) if (w.toLowerCase() === lower) verdicts.set(w, true);
  verdicts.set(word, true);
  worker?.postMessage({ type: "add", words: [lower] });
  const st = useSettings.getState();
  if (!st.settings.spellWords.includes(lower)) st.patch({ spellWords: [...st.settings.spellWords, lower].slice(-2000) });
  for (const fn of learnt) fn();
}

/** Takes a word back out of the person's own dictionary: it is checked again from now on. */
export function forget(word: string): void {
  const lower = word.toLowerCase();
  for (const w of [...verdicts.keys()]) if (w.toLowerCase() === lower) verdicts.delete(w);
  worker?.postMessage({ type: "remove", words: [lower] });
  const st = useSettings.getState();
  if (st.settings.spellWords.includes(lower)) st.patch({ spellWords: st.settings.spellWords.filter((w) => w !== lower) });
  for (const fn of learnt) fn();
}

/** Called whenever a word is added to the dictionary or taken out, so marks already drawn can be drawn again. */
export function onLearn(fn: () => void): () => void {
  learnt.add(fn);
  return () => learnt.delete(fn);
}

/** The word at a place in a text, if there is one worth checking there. */
export function wordAt(text: string, at: number): Word | null {
  return wordsOf(text).find((w) => at >= w.start && at <= w.end) ?? null;
}
