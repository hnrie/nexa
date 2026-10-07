/**
 * What a plugin says about itself, read from its code as text, without
 * running any of it. Loading a plugin runs its module's top level with the
 * person's full access, so before they have agreed to anything (the review
 * stage of adding one, or an update from its link) the code is only read.
 *
 * Only what is written out plainly is read: `apiVersion: 2`, a list of string
 * literals for `permissions`, and string literals for the name, description,
 * version and author. A plugin that builds its list some other way gets
 * nothing granted, and can be given permissions on the Plugins page. What is
 * granted is always what was shown.
 */
import { cleanPermissions, type PermissionName } from "./permissions";

export interface Declaration {
  /** 1 for a plugin that says nothing or 1, 2 for 2, or the number it gives. */
  apiVersion: number;
  /** The permissions written out in the code; null when it has no list written out plainly. */
  permissions: PermissionName[] | null;
  name: string | null;
  description: string | null;
  version: string | null;
  author: string | null;
}

/** The code with comments blanked out (strings kept), so a commented-out line is not read as the real one. */
function withoutComments(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const next = code[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const STRING = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\$]|\\\\.)*`";

/** A JavaScript string literal's value, for the plain ones this reader takes. */
function unquote(lit: string): string {
  const body = lit.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_m, e: string) => {
    if (e.startsWith("u{")) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e.startsWith("u") || e.startsWith("x")) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[e] ?? e;
  });
}

function field(code: string, key: string): string | null {
  const m = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*(${STRING})`).exec(code);
  return m ? unquote(m[1]!).slice(0, 300) : null;
}

export function readDeclaration(code: string): Declaration {
  const text = withoutComments(code);
  const v = /(?:^|[\s,{])apiVersion\s*:\s*(\d+)\b/.exec(text);
  let permissions: PermissionName[] | null = null;
  const list = /(?:^|[\s,{])permissions\s*:\s*\[([^\]]*)\]/.exec(text);
  if (list) {
    const items = list[1]!.split(",").map((x) => x.trim()).filter(Boolean);
    const plain = items.every((x) => new RegExp(`^(?:${STRING})$`).test(x));
    if (plain) permissions = cleanPermissions(items.map(unquote));
  }
  return {
    apiVersion: v ? Number(v[1]) : 1,
    permissions,
    name: field(text, "name"),
    description: field(text, "description"),
    version: field(text, "version"),
    author: field(text, "author"),
  };
}
