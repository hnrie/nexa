import { Fragment, type ReactNode } from "react";
import type { LegalBlock, LegalDoc } from "@/lib/legalDocs";
import s from "./Legal.module.css";

/** Emails and this site's own pages, made into links; everything else stays text. */
const LINKABLE = /([\w.+-]+@[\w-]+\.[\w.]+)|((?:https?:\/\/)?chat\.evilion\.xyz(?:\/[\w/-]*)?)/g;

function linkify(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINKABLE)) {
    const at = m.index ?? 0;
    // a trailing full stop belongs to the sentence, not the address
    const raw = m[0].replace(/\.$/, "");
    if (at > last) out.push(text.slice(last, at));
    if (m[1]) out.push(<a key={at} href={`mailto:${raw}`}>{raw}</a>);
    else {
      const path = raw.replace(/^(https?:\/\/)?chat\.evilion\.xyz/, "") || "/";
      out.push(<a key={at} href={path}>{raw}</a>);
    }
    last = at + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : <>{out}</>;
}

function Block({ b }: { b: LegalBlock }) {
  switch (b.kind) {
    case "p":
      return <p className={s.body}>{linkify(b.text)}</p>;
    case "ul":
      return (
        <ul className={s.list}>
          {b.items.map((it, i) => (
            <li key={i}>{linkify(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className={[s.list, s.rules].join(" ")}>
          {b.items.map((it, i) => (
            <li key={i}>{linkify(it)}</li>
          ))}
        </ol>
      );
    case "item":
      return (
        <div className={s.item}>
          <p className={s.body}>
            {b.lead ? <strong>{b.lead}: </strong> : null}
            {linkify(b.text)}
          </p>
          {b.sub.length ? (
            <ul className={s.list}>
              {b.sub.map((it, i) => (
                <li key={i}>{linkify(it)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    default:
      return (
        <p className={s.lines}>
          {b.lines.map((l, i) => (
            <Fragment key={i}>
              {i ? <br /> : null}
              {linkify(l)}
            </Fragment>
          ))}
        </p>
      );
  }
}

/**
 * One of the legal documents, whole: its title and effective date, a table of
 * contents, and every section as written.
 */
export function LegalDocument({ doc, showTitle = true, toc = true }: { doc: LegalDoc; showTitle?: boolean; toc?: boolean }) {
  const meta = (label: string) => doc.meta.find((m) => m.label.toLowerCase() === label)?.value;
  const runBy = meta("run by");
  const contact = meta("contact");
  return (
    <article className={s.doc} lang="en">
      {showTitle ? (
        <header className={s.docHead}>
          <h2 className={s.docTitle}>{doc.title}</h2>
          <p className={s.docMeta}>
            <span className={s.effective}>Effective {doc.effective}</span>
            {runBy ? <span>Run by {linkify(runBy)}</span> : null}
            {contact ? <span>{linkify(contact)}</span> : null}
          </p>
        </header>
      ) : null}
      {doc.intro.map((b, i) => (
        <Block key={i} b={b} />
      ))}
      {toc && doc.sections.length > 3 ? (
        <nav className={s.toc} aria-label="Contents">
          <ol>
            {doc.sections.map((sec) => (
              <li key={sec.id}>
                <a href={`#${sec.id}`}>{sec.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {doc.sections.map((sec) => (
        <section key={sec.id} id={sec.id} className={s.section} aria-labelledby={`${sec.id}-h`}>
          <h3 className={s.h} id={`${sec.id}-h`}>
            <span className={s.num}>{sec.number}.</span> {sec.title}
          </h3>
          {sec.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </section>
      ))}
    </article>
  );
}
