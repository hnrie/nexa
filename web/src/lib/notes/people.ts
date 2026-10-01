/**
 * The colours people are drawn in inside a note: their caret, their
 * selection, the name flag over the caret and the ring round their face. Each
 * is deep enough to carry white type in a light theme and bright enough to
 * see against a dark one. Brand violet is not among them: that is this
 * page's own caret.
 */
export const PERSON_HUES = ["#d9473d", "#2f7bd8", "#138a7e", "#c93d7a", "#b97a12", "#4b8f2a", "#5361d6", "#b5612a"] as const;

const given = new Map<string, Map<string, number>>();

/** Where in the list someone's colour is looked for first: the same for them in every note. */
function preferred(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) >>> 0;
  return h % PERSON_HUES.length;
}

/**
 * The colour someone has in a note: their own one where it is free, the
 * next free one where it is not, so two people in a note look different. It
 * stays theirs on this page for as long as the page is open.
 */
export function personHue(noteId: string, userId: string): string {
  let inNote = given.get(noteId);
  if (!inNote) given.set(noteId, (inNote = new Map()));
  let at = inNote.get(userId);
  if (at === undefined) {
    const taken = new Set(inNote.values());
    const first = preferred(userId);
    at = first;
    for (let k = 0; k < PERSON_HUES.length; k++) {
      const c = (first + k) % PERSON_HUES.length;
      if (!taken.has(c)) {
        at = c;
        break;
      }
    }
    inNote.set(userId, at);
  }
  return PERSON_HUES[at]!;
}

/** Forgets the colours handed out, for the next account on this tab. */
export function forgetHues(): void {
  given.clear();
}
