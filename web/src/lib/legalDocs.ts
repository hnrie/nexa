/**
 * The Terms of Service and the Privacy Policy, read straight from their
 * canonical text files in docs/legal, so what the app shows is word for word
 * what was written — there is no second copy to drift.
 *
 * The files are plain text in a small, regular format: a title, a few
 * "Label: value" lines, then blocks separated by blank lines. A block is a
 * numbered section heading ("5. HOW MODERATION WORKS"), a bullet list
 * ("- " items, continued with two spaces), a numbered list ("  1. " items),
 * a lettered item ("a) Lead: text", with "   - " sub-bullets), an indented
 * run of lines (contact details), or a paragraph. Lines are wrapped for
 * reading as text, so they are joined back up here.
 */
import { useEffect, useState } from "react";
import { loadChunk } from "./lazyChunk";

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "item"; label: string; lead: string; text: string; sub: string[] }
  | { kind: "lines"; lines: string[] };

export interface LegalSection {
  id: string;
  number: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  title: string;
  effective: string;
  meta: { label: string; value: string }[];
  intro: LegalBlock[];
  sections: LegalSection[];
}

const HEADING = /^(\d+)\.\s+([A-Z0-9][A-Z0-9 ,()'’&/-]*)$/;
const LETTERED = /^([a-z])\)\s+(.*)$/;

/** Joins wrapped lines back into one line of text. */
function unwrap(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

/** "WHAT IS ENCRYPTED (NOBODY WHO RUNS NEXA CAN READ IT)" → "What is encrypted (nobody who runs Nexa can read it)". */
export function headingCase(s: string): string {
  const lower = s.toLowerCase();
  const fixed = lower.replace(/\bnexa\b/g, "Nexa").replace(/\bip\b/g, "IP").replace(/\bdm\b/g, "DM");
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);
}

/** Splits items that start with `marker` (continuation lines are indented further). */
function items(lines: string[], marker: RegExp): string[] {
  const out: string[][] = [];
  for (const line of lines) {
    const m = line.match(marker);
    if (m) out.push([line.slice(m[0].length)]);
    else if (out.length) out[out.length - 1]!.push(line);
  }
  return out.map(unwrap);
}

function block(lines: string[]): LegalBlock {
  const first = lines[0]!;
  if (/^- /.test(first)) return { kind: "ul", items: items(lines, /^- /) };
  if (/^\s+\d+\.\s/.test(first)) return { kind: "ol", items: items(lines, /^\s+\d+\.\s+/) };
  const lettered = first.match(LETTERED);
  if (lettered) {
    const body: string[] = [];
    const subLines: string[] = [];
    let inSub = false;
    for (const [i, line] of lines.entries()) {
      const text = i === 0 ? lettered[2]! : line;
      if (/^\s+- /.test(line)) inSub = true;
      (inSub ? subLines : body).push(text);
    }
    const whole = unwrap(body);
    const colon = whole.indexOf(":");
    const lead = colon > 0 && colon <= 120 ? whole.slice(0, colon) : "";
    return { kind: "item", label: lettered[1]!, lead, text: lead ? whole.slice(colon + 1).trim() : whole, sub: items(subLines, /^\s+- /) };
  }
  if (lines.every((l) => /^\s{2,}\S/.test(l))) return { kind: "lines", lines: lines.map((l) => l.trim()) };
  return { kind: "p", text: unwrap(lines) };
}

export function parseLegal(src: string, idPrefix: string): LegalDoc {
  const text = src.replace(/\r\n/g, "\n");
  const chunks = text.split(/\n\s*\n/).map((c) => c.split("\n").filter((l) => l.trim() !== ""));
  const head = chunks.shift() ?? [];
  const title = headingCase((head[0] ?? "").replace(/^NEXA\s*-\s*/i, ""));
  const meta: LegalDoc["meta"] = [];
  for (const line of head.slice(1)) {
    const at = line.indexOf(":");
    if (at > 0) meta.push({ label: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
  }
  const effective = meta.find((m) => m.label.toLowerCase() === "effective")?.value ?? "";
  const doc: LegalDoc = { title, effective, meta, intro: [], sections: [] };
  for (const lines of chunks) {
    if (lines.length === 0) continue;
    if (/^END OF /.test(lines[0]!.trim())) break;
    const h = lines.length === 1 ? lines[0]!.trim().match(HEADING) : null;
    if (h) {
      doc.sections.push({ id: `${idPrefix}-${h[1]}`, number: h[1]!, title: headingCase(h[2]!), blocks: [] });
      continue;
    }
    const b = block(lines);
    const current = doc.sections[doc.sections.length - 1];
    if (current) current.blocks.push(b);
    else doc.intro.push(b);
  }
  return doc;
}

export interface LegalDocs {
  terms: LegalDoc;
  privacy: LegalDoc;
}

let cache: Promise<LegalDocs> | null = null;
let ready: LegalDocs | null = null;

/**
 * Both documents, parsed once. They arrive in a chunk of their own: the text
 * is only needed by whoever opens it, not by every start of the app.
 */
export function loadLegalDocs(): Promise<LegalDocs> {
  cache ??= loadChunk(() => Promise.all([import("../../../docs/legal/TERMS_OF_SERVICE.txt?raw"), import("../../../docs/legal/PRIVACY_POLICY.txt?raw")])).then(
    ([terms, privacy]) => {
      ready = { terms: parseLegal(terms.default, "terms"), privacy: parseLegal(privacy.default, "privacy") };
      return ready;
    },
    (err: unknown) => {
      // let the next reader try again
      cache = null;
      throw err;
    },
  );
  return cache;
}

/**
 * The documents for a component, loaded once `wanted`: null for the moment
 * that takes.
 */
export function useLegalDocs(wanted = true): LegalDocs | null {
  const [docs, setDocs] = useState<LegalDocs | null>(ready);
  useEffect(() => {
    if (docs || !wanted) return;
    let alive = true;
    loadLegalDocs().then(
      (d) => alive && setDocs(d),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [docs, wanted]);
  return docs;
}
