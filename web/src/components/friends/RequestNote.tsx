import { useEffect, useState } from "react";
import { openRequestNote } from "@/lib/requestNote";
import { keysGoneHooks, useKeys } from "@/stores/keys";
import s from "./Friends.module.css";

/**
 * Notes already opened this session, by their sealed text. The Pending tab
 * mounts its rows afresh each time it is shown, and a note opened again every
 * time arrived a moment after its row and pushed the list down. Forgotten
 * along with the keys (a lock, a sign-out).
 */
const opened = new Map<string, string | null>();
keysGoneHooks.push(() => opened.clear());

/**
 * The note an incoming friend request came with, opened with this account's
 * own identity key. Text only, never markup; nothing at all when it will not
 * open, since a note is extra.
 */
export function RequestNote({ sealed }: { sealed: string }) {
  const identity = useKeys((k) => k.identity);
  const [text, setText] = useState<string | null>(() => opened.get(sealed) ?? null);
  useEffect(() => {
    if (!identity) {
      setText(null);
      return;
    }
    if (opened.has(sealed)) {
      setText(opened.get(sealed) ?? null);
      return;
    }
    let live = true;
    void openRequestNote(identity, sealed).then((note) => {
      // locked or signed out meanwhile: this belongs to a session that ended
      if (useKeys.getState().identity !== identity) return;
      opened.set(sealed, note);
      if (live) setText(note);
    });
    return () => {
      live = false;
    };
  }, [sealed, identity]);
  if (!text) return null;
  // The bar keeps to the page's own side; only the words take their own
  // direction, so a note in Arabic in an English list still sits under the
  // name rather than across the row by the buttons.
  return (
    <span className={s.rowNote}>
      <span className={s.rowNoteText} dir="auto" title={text} data-testid="friend-request-note">
        {text}
      </span>
    </span>
  );
}
