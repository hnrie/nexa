import { useMemo } from "react";
import { noteLinksIn } from "@/lib/appLinks";
import { NoteLinkView, linkSecret } from "./NoteLinkView";
import s from "./Notes.module.css";

/**
 * A card under a message for each note share link it has. The card is made
 * here, on each device that shows the message: what the link leads to can
 * only be read with the key in the link, which the message carries sealed.
 */
export function NoteCards({ nodes }: { nodes: unknown }) {
  const links = useMemo(() => noteLinksIn(nodes), [nodes]);
  if (links.length === 0) return null;
  return (
    <div className={s.linkCards}>
      {links.map((l) => (
        <NoteLinkView key={l.token} secret={linkSecret(l.token, l.hash)} variant="card" />
      ))}
    </div>
  );
}
