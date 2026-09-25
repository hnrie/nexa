/**
 * The search engine: the messages this device has decrypted, and the index
 * that finds them.
 *
 * A query goes in three steps. The index narrows it to the messages holding
 * every word; the filters (who, where, when, what it carries) go through
 * those; and what is left is checked against the words themselves, so a
 * phrase is a phrase and a left-out word is left out. With no words at all
 * the filters go through the whole conversation, or everything.
 *
 * Results come back for one tab at a time (messages, media, links, files),
 * with how many there are in each, sorted and a page at a time.
 */
import { compareIds } from "@/lib/ids";
import { matchFilters, matchText, type ResolvedQuery } from "@/lib/search";
import { filesOf, linksOf, mediaOf, searchableText, type SearchDoc } from "./doc";
import { fold, termTokens, tokenize, type Token } from "./text";
import { TokenIndex, countOf, intersectInto, type OrdSet } from "./tokenIndex";

export type Tab = "messages" | "media" | "links" | "files";
export type Sort = "newest" | "oldest" | "relevance";
export const TABS: readonly Tab[] = ["messages", "media", "links", "files"];

export interface EngineRequest {
  query: ResolvedQuery;
  /** The channels to look in, or null for everywhere. */
  scope: string[] | null;
  /** Authors whose messages are left out of the results. */
  hide?: string[];
  tab: Tab;
  sort: Sort;
  offset: number;
  limit: number;
}

export interface EngineResult {
  /** How much matched in each tab: messages, pictures and clips, links, files. */
  counts: Record<Tab, number>;
  /** How many messages the chosen tab's results come from, for paging. */
  total: number;
  /** One page of them. */
  docs: SearchDoc[];
}

export const EMPTY_RESULT: EngineResult = { counts: { messages: 0, media: 0, links: 0, files: 0 }, total: 0, docs: [] };

/** What an upsert did: nothing, a new message, or a changed one. */
export type Change = "same" | "added" | "changed";

/** The BM25 constants, at their usual values. */
const K1 = 1.2;
const B = 0.75;

function sameDoc(a: SearchDoc, b: SearchDoc): boolean {
  return a.ed === b.ed && a.fl === b.fl && a.t === b.t && (a.att?.length ?? 0) === (b.att?.length ?? 0) && (a.emb?.length ?? 0) === (b.emb?.length ?? 0) && !!a.st === !!b.st && (a.mn?.length ?? 0) === (b.mn?.length ?? 0);
}

function tokensOf(d: SearchDoc): string[] {
  return tokenize(fold(searchableText(d))).map((t) => t.text);
}

export class SearchEngine {
  private docs: (SearchDoc | undefined)[] = [];
  private lengths: number[] = [];
  private readonly ords = new Map<string, number>();
  private readonly byChannel = new Map<string, number[]>();
  private index = new TokenIndex();
  private dead = 0;
  private tokenTotal = 0;

  /** How many messages it holds. */
  get size(): number {
    return this.ords.size;
  }

  has(id: string): boolean {
    return this.ords.has(id);
  }

  get(id: string): SearchDoc | undefined {
    const o = this.ords.get(id);
    return o === undefined ? undefined : this.docs[o];
  }

  /** Adds a message, or replaces the copy held if it has changed. */
  upsert(d: SearchDoc): Change {
    const o = this.ords.get(d.id);
    if (o !== undefined) {
      const prev = this.docs[o]!;
      if (sameDoc(prev, d)) return "same";
      this.drop(o);
      this.put(d);
      return "changed";
    }
    this.put(d);
    return "added";
  }

  private put(d: SearchDoc): void {
    const o = this.docs.length;
    const tokens = tokensOf(d);
    this.docs.push(d);
    this.lengths.push(tokens.length);
    this.tokenTotal += tokens.length;
    this.ords.set(d.id, o);
    let list = this.byChannel.get(d.c);
    if (!list) {
      list = [];
      this.byChannel.set(d.c, list);
    }
    list.push(o);
    this.index.add(o, tokens);
  }

  private drop(o: number): void {
    const d = this.docs[o];
    if (!d) return;
    this.docs[o] = undefined;
    this.ords.delete(d.id);
    this.tokenTotal -= this.lengths[o] ?? 0;
    this.dead += 1;
  }

  /** Forgets a message; says whether it was held. */
  remove(id: string): boolean {
    const o = this.ords.get(id);
    if (o === undefined) return false;
    this.drop(o);
    this.maybeCompact();
    return true;
  }

  /** Forgets every message of a channel, and says which went. */
  removeChannel(channelId: string): string[] {
    const gone: string[] = [];
    for (const o of this.byChannel.get(channelId) ?? []) {
      const d = this.docs[o];
      if (d && d.c === channelId) {
        gone.push(d.id);
        this.drop(o);
      }
    }
    this.byChannel.delete(channelId);
    this.maybeCompact();
    return gone;
  }

  /** The ids held for a channel whose ids fall strictly between two others. */
  idsBetween(channelId: string, low: string, high: string): string[] {
    const out: string[] = [];
    for (const o of this.byChannel.get(channelId) ?? []) {
      const d = this.docs[o];
      if (d && d.c === channelId && compareIds(d.id, low) > 0 && compareIds(d.id, high) < 0) out.push(d.id);
    }
    return out;
  }

  /** How many messages it holds for each channel. */
  channelCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of this.docs) if (d) out[d.c] = (out[d.c] ?? 0) + 1;
    return out;
  }

  /** Every message held, for writing out. */
  all(): SearchDoc[] {
    return this.docs.filter((d): d is SearchDoc => d !== undefined);
  }

  clear(): void {
    this.docs = [];
    this.lengths = [];
    this.ords.clear();
    this.byChannel.clear();
    this.index = new TokenIndex();
    this.dead = 0;
    this.tokenTotal = 0;
  }

  /**
   * Numbers the messages afresh once a quarter of the numbers point at
   * nothing, so deleted and edited messages stop costing memory and time.
   */
  private maybeCompact(): void {
    if (this.dead < 1000 || this.dead * 4 < this.docs.length) return;
    this.compact();
  }

  compact(): void {
    const live = this.all();
    this.clear();
    for (const d of live) this.put(d);
  }

  /** The candidates the index gives for the query's words, or null when it has no words to narrow by. */
  private candidates(r: ResolvedQuery): { set: OrdSet; df: Map<string, number> } | null {
    const words = [...r.terms, ...r.phrases];
    const size = this.docs.length;
    let set: OrdSet | null = null;
    const df = new Map<string, number>();
    for (const w of words) {
      const toks: Token[] = termTokens(w);
      let own: OrdSet | null = null;
      for (const tok of toks) {
        const found = this.index.lookup(tok, size);
        if (own === null) own = found;
        else intersectInto(own, found);
      }
      // a word with nothing the index keys by (an emoji, punctuation) is left
      // to the check against the text
      if (own === null) continue;
      df.set(w, countOf(own));
      if (set === null) set = own;
      else if (!intersectInto(set, own)) return { set, df };
    }
    return set === null ? null : { set, df };
  }

  query(req: EngineRequest): EngineResult {
    const r = req.query;
    if ((r.from && r.from.length === 0) || (r.mentions && r.mentions.length === 0 && !r.everyone) || (r.since !== null && r.until !== null && r.since >= r.until)) return EMPTY_RESULT;
    let allowed: Set<string> | null = req.scope ? new Set(req.scope) : null;
    if (r.channels) allowed = new Set(r.channels.filter((c) => !allowed || allowed.has(c)));
    if (allowed && allowed.size === 0) return EMPTY_RESULT;
    const hide = req.hide?.length ? new Set(req.hide) : null;
    const hasWords = r.terms.length > 0 || r.phrases.length > 0 || r.exclude.length > 0;
    const cand = this.candidates(r);

    const matched: number[] = [];
    const consider = (o: number): void => {
      const d = this.docs[o];
      if (!d) return;
      if (allowed && !allowed.has(d.c)) return;
      if (hide?.has(d.a)) return;
      if (!matchFilters(d, r)) return;
      if (hasWords && !matchText(fold(searchableText(d)), r)) return;
      matched.push(o);
    };
    if (cand) {
      const s = cand.set;
      for (let o = 0; o < s.length; o++) if (s[o]) consider(o);
    } else if (allowed) {
      for (const c of allowed) for (const o of this.byChannel.get(c) ?? []) consider(o);
    } else {
      for (let o = 0; o < this.docs.length; o++) consider(o);
    }

    const counts: Record<Tab, number> = { messages: matched.length, media: 0, links: 0, files: 0 };
    const inTab: number[] = [];
    for (const o of matched) {
      const d = this.docs[o]!;
      const media = mediaOf(d).length;
      const links = linksOf(d).length;
      const files = filesOf(d).length;
      counts.media += media;
      counts.links += links;
      counts.files += files;
      const n = req.tab === "messages" ? 1 : req.tab === "media" ? media : req.tab === "links" ? links : files;
      if (n > 0) inTab.push(o);
    }

    const byId = (a: number, b: number) => compareIds(this.docs[a]!.id, this.docs[b]!.id);
    if (req.sort === "oldest") inTab.sort(byId);
    else if (req.sort === "relevance" && (r.terms.length || r.phrases.length)) {
      const scores = this.scores(inTab, r, cand?.df ?? new Map());
      inTab.sort((a, b) => scores.get(b)! - scores.get(a)! || byId(b, a));
    } else inTab.sort((a, b) => byId(b, a));

    const page = inTab.slice(req.offset, req.offset + req.limit).map((o) => this.docs[o]!);
    return { counts, total: inTab.length, docs: page };
  }

  /**
   * How well each message matches, by BM25: a word counts for more the rarer
   * it is and the more often it appears, and for less in a long message. A
   * word that is a whole word in the message beats one that only starts one.
   */
  private scores(ords: number[], r: ResolvedQuery, df: Map<string, number>): Map<number, number> {
    const n = Math.max(1, this.size);
    const avg = Math.max(1, this.tokenTotal / n);
    const out = new Map<number, number>();
    for (const o of ords) {
      const d = this.docs[o]!;
      const folded = fold(searchableText(d));
      const toks = tokenize(folded);
      const len = this.lengths[o] ?? toks.length;
      let score = 0;
      for (const w of r.terms) {
        let tf = 0;
        let whole = false;
        for (const t of toks) {
          if (t.text.startsWith(w)) {
            tf += 1;
            if (t.text === w) whole = true;
          }
        }
        // a term with no tokens of its own (an emoji) still matched as text
        if (tf === 0 && folded.includes(w)) tf = 1;
        const docs = df.get(w) ?? 1;
        const idf = Math.log(1 + (n - docs + 0.5) / (docs + 0.5));
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg))) + (whole ? idf * 0.3 : 0);
      }
      for (const p of r.phrases) {
        const docs = df.get(p) ?? 1;
        score += 1.5 * Math.log(1 + (n - docs + 0.5) / (docs + 0.5));
      }
      out.set(o, score);
    }
    return out;
  }
}
