import { ChevronDown, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { TextInput } from "@/components/common/TextInput";
import catalogue from "@/data/licenses.json";
import s from "./Settings.module.css";
import l from "./Licenses.module.css";

import { t } from "@/i18n";

interface Package {
  /** Which build this ships in: the key the headings and the filter are named by. */
  part: string;
  name: string;
  version: string;
  /** SPDX id, or "Unknown" where nothing said and nothing could be read. */
  license: string;
  url: string;
  /** This package's own notice, lifted out of the licence text it shares. */
  copyright?: string;
}

interface Catalogue {
  parts: string[];
  self: { name: string; text: string } | null;
  licenses: Record<string, { name: string; text: string } | undefined>;
  packages: Package[];
}

// tools/licenses.py writes this out of the lockfiles. TypeScript would otherwise
// infer the shape of all three hundred entries, and a field only some of them carry
// would come back as a union nothing can read.
const data = catalogue as unknown as Catalogue;

/** The name of a part, per render, so the headings follow the language. */
function partName(part: string): string {
  switch (part) {
    case "web":
      return t("settings.licenses.webApp");
    case "desktop":
      return t("settings.licenses.desktopApp");
    case "server":
      return t("settings.licenses.server");
    case "android":
      return t("settings.licenses.androidApp");
    case "assets":
      return t("settings.licenses.fontsAndArtwork");
    default:
      return part;
  }
}

/**
 * Settings → Licenses: the open-source software Nexa is built on, and the terms it
 * comes under.
 *
 * Most of these licences only let us ship the code on the condition that their text
 * travels with it, which is what this page is for. The list is generated from the
 * lockfiles rather than written by hand, so it says what a build actually contains
 * instead of what somebody remembered to add.
 */
export default function LicensesPage() {
  const [query, setQuery] = useState("");
  const [part, setPart] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = data.packages.filter(
      (p) => (part === null || p.part === part) && (!needle || p.name.toLowerCase().includes(needle) || p.license.toLowerCase().includes(needle)),
    );
    // The order the generator wrote is already part, then name; grouping keeps it.
    return data.parts.map((id) => ({ id, packages: matches.filter((p) => p.part === id) })).filter((g) => g.packages.length > 0);
  }, [query, part]);

  return (
    <>
      <h2 className={s.title}>{t("settings.licenses.licenses")}</h2>
      <p className={s.hint}>{t("settings.licenses.nexaIsBuiltOnOpenSource")}</p>
      {data.self ? (
        <>
          <h3 className={s.h5}>{t("settings.licenses.nexaItself")}</h3>
          <pre className={l.text} dir="ltr">{data.self.text}</pre>
        </>
      ) : null}
      <div className={l.search}>
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("settings.licenses.searchPackages")} aria-label={t("settings.licenses.searchPackages")} data-testid="licenses-search" />
      </div>
      <div className={l.filters}>
        <button className={l.filter} data-on={part === null} onClick={() => setPart(null)}>{t("settings.licenses.everything")}</button>
        {data.parts.map((id) => (
          <button key={id} className={l.filter} data-on={part === id} onClick={() => setPart(id)} data-part={id}>{partName(id)}</button>
        ))}
      </div>
      {groups.length === 0 ? <p className={s.hint}>{t("settings.licenses.noPackageMatchesThat")}</p> : null}
      {groups.map((group) => (
        <section key={group.id}>
          <h3 className={s.h5}>
            {partName(group.id)} <span className={l.count}>{group.packages.length}</span>
          </h3>
          <div className={l.list}>
            {group.packages.map((p) => {
              // Two parts can ship a package of the same name, and npm can install
              // one name at two versions, so the key has to carry all three.
              const id = `${p.part}/${p.name}@${p.version}`;
              const shown = open === id;
              const text = data.licenses[p.license]?.text;
              return (
                <div key={id} className={l.item} data-open={shown}>
                  <button className={l.row} aria-expanded={shown} onClick={() => setOpen(shown ? null : id)} data-package={p.name}>
                    <span className={l.name} dir="ltr">{p.name}</span>
                    <span className={l.version} dir="ltr">{p.version}</span>
                    <span className={l.spdx} dir="ltr">{p.license}</span>
                    <ChevronDown className={l.chevron} size={16} aria-hidden="true" />
                  </button>
                  {shown ? (
                    <div className={l.detail}>
                      {p.copyright ? <p className={l.copyright} dir="ltr">{p.copyright}</p> : null}
                      {text ? <pre className={l.text} dir="ltr">{text}</pre> : null}
                      <a className={l.link} href={p.url} target="_blank" rel="noreferrer noopener">
                        {t("settings.licenses.projectPage")}
                        <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
