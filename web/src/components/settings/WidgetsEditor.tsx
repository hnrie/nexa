import { Bookmark, Gamepad2, GripVertical, Heart, ImagePlus, Library, LoaderCircle, PanelTop, Plus, Search, Check, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { users as usersApi } from "@/api/users";
import { Button } from "@/components/common/Button";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { Modal } from "@/components/common/Modal";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { GameCover, ProfileWidgets, widgetTitle } from "@/components/profile/Widgets";
import { useReorder } from "@/hooks/useReorder";
import { Tr, t } from "@/i18n";
import { describeError } from "@/lib/errors";
import { LIMITS, MAX_CARDS, MOST_GAMES, WIDGET_TYPES, widgetImageUrl, type CardWidget, type GameWidget, type Widget, type WidgetGame, type WidgetStat, type WidgetType } from "@/lib/widgets";
import { useUI } from "@/stores/ui";
import s from "./WidgetsEditor.module.css";

const KIND_ICONS: Record<WidgetType, LucideIcon> = { favorite: Heart, playing: Gamepad2, wishlist: Bookmark, played: Library, custom: PanelTop };
const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";
/** What a dragged row carries, so a drop from anywhere else is ignored. */
const ROW_DRAG = "application/x-nexa-widget";

/**
 * Drag a row of a list over the others, with where it would land: the row
 * under the pointer and which half of it. Shared by the widgets in Settings
 * and the games in a widget, which are both short lists of rows. `row` goes
 * on each row, which is where a drop lands; `grip` on what is dragged, the
 * whole row where it holds only buttons, or just its handle where it holds a
 * text box (one inside something draggable cannot be clicked into in every
 * browser).
 */
function useRowDrag<T>(items: T[], keyOf: (item: T) => string, onChange: (next: T[]) => void) {
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);
  const end = () => {
    setDrag(null);
    setDrop(null);
  };
  const row = (key: string) => ({
    "data-dragging": drag === key ? "" : undefined,
    "data-drop": drop?.key === key ? (drop.after ? "after" : "before") : undefined,
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (drag === key) return setDrop(null);
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (drop?.key !== key || drop.after !== after) setDrop({ key, after });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (drag && drop && drag !== drop.key) {
        const moving = items.find((x) => keyOf(x) === drag);
        if (moving !== undefined) {
          const rest = items.filter((x) => keyOf(x) !== drag);
          const at = rest.findIndex((x) => keyOf(x) === drop.key);
          rest.splice(at + (drop.after ? 1 : 0), 0, moving);
          onChange(rest);
        }
      }
      end();
    },
  });
  const grip = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(ROW_DRAG, key);
      // the whole row goes with the pointer, wherever it was picked up
      const li = e.currentTarget.closest("li");
      if (li && li !== e.currentTarget) {
        const r = li.getBoundingClientRect();
        e.dataTransfer.setDragImage(li, e.clientX - r.left, e.clientY - r.top);
      }
      setDrag(key);
    },
    onDragEnd: end,
  });
  return { row, grip };
}

/** Moves the item with `key` by `delta` places, or says it cannot. */
function moved<T>(items: T[], keyOf: (item: T) => string, key: string, delta: number): T[] | null {
  const at = items.findIndex((x) => keyOf(x) === key);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= items.length) return null;
  const next = [...items];
  const [item] = next.splice(at, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Add a Widget: the five kinds, each with what it shows, and why one cannot be added. */
export function AddWidgetDialog({ widgets, onPick, onClose }: { widgets: Widget[]; onPick: (type: WidgetType) => void; onClose: () => void }) {
  const cards = widgets.filter((w) => w.type === "custom").length;
  return (
    <Modal open onClose={onClose} title={t("widgets.addOne")} width={480}>
      <ul className={s.kinds}>
        {WIDGET_TYPES.map((type) => {
          const Icon = KIND_ICONS[type];
          const taken = type === "custom" ? cards >= MAX_CARDS : widgets.some((w) => w.type === type);
          return (
            <li key={type}>
              <button className={s.kind} disabled={taken} onClick={() => onPick(type)} data-testid={`widget-kind-${type}`}>
                <span className={s.icon} aria-hidden="true"><Icon size={20} /></span>
                <span className={s.kindText}>
                  <span className={s.kindName}>{widgetTitle({ type })}</span>
                  <span className={s.kindAbout}>{taken ? (type === "custom" ? t("widgets.cardsFull") : t("widgets.onProfile")) : t(`widgets.about.${type}`)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

interface FoundGame {
  id: string;
  name: string;
  cover?: string;
  year?: number;
}

const gameKey = (g: WidgetGame) => (g.id ? `g:${g.id}` : `n:${g.name.toLowerCase()}`);
const TAG_SUGGESTIONS = ["casual", "competitive", "coop", "solo", "ranked", "withFriends"];

/**
 * A games widget: a search of IGDB's games, through this server, that adds
 * what it finds, or a game typed in by name with a picture of its own; and
 * the games chosen, in order, with how each is played (Playing Now) or why
 * it is the one (Favourite Game).
 */
export function GameWidgetDialog({ initial, onDone, onClose }: { initial: GameWidget; onDone: (w: GameWidget) => void; onClose: () => void }) {
  const toast = useUI((u) => u.toast);
  const most = MOST_GAMES[initial.type];
  const single = most === 1;
  const [games, setGames] = useState<WidgetGame[]>(initial.games);
  const [note, setNote] = useState(initial.note ?? "");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; games: FoundGame[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  // whether this server can search IGDB at all, asked once as the dialog opens
  const [ready, setReady] = useState<boolean | null>(null);
  const [crop, setCrop] = useState<{ file: File; key: string } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [tagFocus, setTagFocus] = useState<string | null>(null);
  const seq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pictureFor = useRef<string | null>(null);
  const searchLabel = useId();
  const query = q.trim();

  useEffect(() => {
    let alive = true;
    usersApi.searchGames("").then(
      (res) => alive && setReady(res.ready),
      () => alive && setReady(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const n = ++seq.current;
    setFailed(false);
    if (!query || ready === false) {
      setFound(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      usersApi.searchGames(query).then(
        (res) => {
          if (n !== seq.current) return;
          setReady(res.ready);
          setFound({ q: query, games: res.games });
          setSearching(false);
        },
        () => {
          if (n !== seq.current) return;
          setFailed(true);
          setSearching(false);
        },
      );
    }, 280);
    return () => clearTimeout(timer);
  }, [query, ready]);

  const has = (g: WidgetGame) => games.some((x) => gameKey(x) === gameKey(g));
  const isFull = !single && games.length >= most;
  const add = (g: WidgetGame) => {
    if (single) return setGames([g]);
    if (has(g)) return setGames(games.filter((x) => gameKey(x) !== gameKey(g)));
    if (isFull) return;
    setGames([...games, g]);
  };
  const addByName = () => {
    const name = query.slice(0, LIMITS.game);
    if (!name) return;
    add({ name });
    setQ("");
    searchRef.current?.focus();
  };
  const patch = (key: string, change: Partial<WidgetGame>) => setGames((list) => list.map((g) => (gameKey(g) === key ? { ...g, ...change } : g)));
  const drag = useRowDrag(games, gameKey, setGames);
  const reorder = useReorder({
    ids: games.map(gameKey),
    move: (key, delta) => {
      const next = moved(games, gameKey, key, delta);
      if (next) setGames(next);
      return !!next;
    },
    name: (key) => games.find((g) => gameKey(g) === key)?.name ?? "",
  });
  const upload = async (key: string, file: Blob, area: { x: number; y: number; w: number; h: number } | null) => {
    setUploading(key);
    try {
      const res = await usersApi.uploadWidgetImage(file, area, "cover");
      patch(key, { image: res.id });
    } catch (err) {
      toast(describeError(err, t("composer.composer.uploadFailed")), "error");
    } finally {
      setUploading(null);
    }
  };
  const choosePicture = (key: string) => {
    pictureFor.current = key;
    fileRef.current?.click();
  };

  // a name typed that the search did not find exactly can go in as it is
  const exact = found?.q === query && found.games.some((g) => g.name.toLowerCase() === query.toLowerCase());
  const byName = !!query && !exact && !games.some((g) => !g.id && g.name.toLowerCase() === query.toLowerCase());
  const results = found && found.q === query ? found.games : [];
  const canSave = games.length > 0 && uploading === null;

  const resultRow = (g: FoundGame) => {
    const game: WidgetGame = { id: g.id, name: g.name, ...(g.cover ? { cover: g.cover } : {}) };
    const on = has(game);
    return (
      <li key={g.id}>
        <button className={s.result} aria-pressed={on} disabled={!on && isFull} onClick={() => add(game)} data-testid="game-result">
          <GameCover game={game} css={30} className={s.resultCover} />
          <span className={s.resultText}>
            <span className={s.resultName} dir="auto">{g.name}</span>
            {g.year ? <span className={s.resultYear}>{g.year}</span> : null}
          </span>
          <span className={s.resultMark} aria-hidden="true">{on ? <Check size={15} /> : <Plus size={15} />}</span>
        </button>
      </li>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={widgetTitle(initial)}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => onDone({ ...initial, games, ...(single && note.trim() ? { note: note.trim() } : { note: undefined }) })} disabled={!canSave} data-testid="widget-done">{t("pick.done")}</Button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const key = pictureFor.current;
          if (f && key) setCrop({ file: f, key });
          e.target.value = "";
        }}
      />
      <span className={s.label} id={searchLabel}>{single ? t("widgets.game.searchOne") : t("widgets.game.searchMany")}</span>
      <div className={s.searchBox}>
        <Search size={17} className={s.searchIcon} aria-hidden="true" />
        <TextInput
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = results[0];
              if (first && !has({ id: first.id, name: first.name })) add({ id: first.id, name: first.name, ...(first.cover ? { cover: first.cover } : {}) });
              else if (!first && byName && ready === false) addByName();
            }
          }}
          maxLength={LIMITS.game}
          placeholder={ready === false ? t("widgets.game.namePlaceholder") : t("widgets.game.searchPlaceholder")}
          aria-labelledby={searchLabel}
          autoComplete="off"
          spellCheck={false}
          data-testid="game-search"
          autoFocus
        />
      </div>
      {ready === false ? <p className={s.note}>{t("widgets.game.notSetUp")}</p> : null}
      {query ? (
        <ul className={s.results} aria-label={t("widgets.game.results")} aria-busy={searching || undefined}>
          {results.map(resultRow)}
          {searching && !results.length ? <li><p className={s.status}>{t("widgets.game.searching")}</p></li> : null}
          {!searching && failed ? <li><p className={s.status}>{t("widgets.game.unavailable")}</p></li> : null}
          {!searching && !failed && ready !== false && found?.q === query && !results.length ? <li><p className={s.status}>{t("widgets.game.noResults")}</p></li> : null}
          {byName && !searching ? (
            <li>
              <button className={s.result} disabled={isFull} onClick={addByName} data-testid="game-by-name">
                <span className={s.byName} aria-hidden="true"><Plus size={14} /></span>
                <span className={s.resultText}><span className={s.resultName} dir="auto">{t("widgets.game.addByName", { name: query })}</span></span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {ready ? (
        <p className={s.credit}>
          <Tr id="widgets.game.credit" values={{ site: <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">IGDB.com</a> }} />
        </p>
      ) : null}

      <div className={s.labelRow}>
        <span className={s.label}>{single ? t("widgets.game.yourFavorite") : t("widgets.game.yours")}</span>
        {!single ? <span className={s.count}>{t("widgets.used", { count: games.length, max: most })}</span> : null}
      </div>
      {games.length === 0 ? (
        <p className={s.empty}>{single ? t("widgets.game.noneYetOne") : t("widgets.game.noneYet")}</p>
      ) : (
        <ul className={s.chosen} aria-label={single ? t("widgets.game.yourFavorite") : t("widgets.game.yours")}>
          {games.map((g) => {
            const key = gameKey(g);
            const row = single ? {} : { "data-reorder-id": key, onKeyDown: reorder.onKeyDown(key), ...drag.row(key) };
            return (
              <li key={key} className={s.chosenRow} data-single={single ? "" : undefined} {...row}>
                {!single ? <span className={s.grip} aria-hidden="true" {...drag.grip(key)}><GripVertical size={16} /></span> : null}
                <GameCover game={g} css={single ? 56 : 36} className={s.chosenCover} />
                <div className={s.chosenMain}>
                  <span className={s.chosenName} dir="auto">{g.name}</span>
                  {!g.cover ? (
                    <div className={s.chosenBtns}>
                      <button className={s.chip} disabled={uploading !== null} onClick={() => choosePicture(key)}>
                        {uploading === key ? <LoaderCircle size={14} className={s.spin} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
                        {g.image ? t("widgets.changePicture") : t("widgets.addPicture")}
                      </button>
                      {g.image ? <button className={s.chip} onClick={() => patch(key, { image: undefined })}>{t("widgets.removePicture")}</button> : null}
                    </div>
                  ) : null}
                  {initial.type === "playing" ? (
                    <TagEditor
                      tags={g.tags ?? []}
                      onChange={(tags) => patch(key, { tags })}
                      game={g.name}
                      suggest={tagFocus === key}
                      onFocus={(on) => setTagFocus(on ? key : null)}
                    />
                  ) : null}
                </div>
                <button className={s.iconBtn} aria-label={t("widgets.game.remove", { name: g.name })} onClick={() => setGames(games.filter((x) => gameKey(x) !== key))}>
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!single && games.length > 1 ? <p className={s.small}>{reorder.hint}</p> : null}
      {reorder.live}

      {single ? (
        <Field label={t("widgets.game.noteLabel")} hint={t("composer.limit.left", { count: LIMITS.note - note.length })} className={s.noteField}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} rows={3} placeholder={t("widgets.game.notePlaceholder")} data-testid="widget-note" />
        </Field>
      ) : null}

      {crop ? (
        <ImageCropModal
          file={crop.file}
          aspect={3 / 4}
          maxSize={400}
          serverCrop
          title={t("widgets.game.cropTitle")}
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            const key = crop.key;
            setCrop(null);
            void upload(key, blob, area ?? null);
          }}
        />
      ) : null}
    </Modal>
  );
}

/** How someone plays a game they are playing now: up to three short tags, with a few to start from. */
function TagEditor({ tags, onChange, game, suggest, onFocus }: { tags: string[]; onChange: (tags: string[]) => void; game: string; suggest: boolean; onFocus: (on: boolean) => void }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, LIMITS.tag);
    setDraft("");
    if (!tag || tags.length >= LIMITS.tags || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };
  const room = tags.length < LIMITS.tags;
  const ideas = TAG_SUGGESTIONS.map((k) => t(`widgets.tag.${k}`)).filter((x) => !tags.some((tag) => tag.toLowerCase() === x.toLowerCase()));
  return (
    <>
      <div className={s.tags}>
        {tags.map((tag) => (
          <span key={tag} className={s.tag} dir="auto">
            {tag}
            <button aria-label={t("widgets.game.removeTag", { tag })} onClick={() => onChange(tags.filter((x) => x !== tag))}><X size={12} /></button>
          </span>
        ))}
        {room ? (
          <input
            className={s.tagInput}
            value={draft}
            maxLength={LIMITS.tag}
            placeholder={t("widgets.game.tagPlaceholder")}
            aria-label={t("widgets.game.tagLabel", { name: game })}
            onChange={(e) => setDraft(e.target.value.replace(/,/g, ""))}
            onKeyDown={onKey}
            onFocus={() => onFocus(true)}
            onBlur={() => {
              add(draft);
              onFocus(false);
            }}
          />
        ) : null}
      </div>
      {suggest && room && ideas.length ? (
        <div className={s.suggest}>
          {ideas.map((idea) => (
            // pressed without taking the focus from the box, which would put the box away first
            <button key={idea} onMouseDown={(e) => e.preventDefault()} onClick={() => add(idea)}>{idea}</button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** A link as it was typed, with the https:// it was most likely meant to have. */
function withScheme(raw: string): string {
  const v = raw.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  return `https://${v.replace(/^\/+/, "")}`;
}

function linkProblem(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname || u.username || u.password) return t("widgets.card.badLink");
    return null;
  } catch {
    return t("widgets.card.badLink");
  }
}

/**
 * A card of your own: a title, a picture across its top or beside the
 * title, a few words, up to six stats and a link, and the card as the
 * profile will show it.
 */
export function CardDialog({ initial, isNew, onDone, onClose }: { initial: CardWidget; isNew: boolean; onDone: (w: CardWidget) => void; onClose: () => void }) {
  const toast = useUI((u) => u.toast);
  const [title, setTitle] = useState(initial.title);
  const [text, setText] = useState(initial.text ?? "");
  const [image, setImage] = useState<{ id: string; shape: "wide" | "square" } | null>(initial.image ? { id: initial.image, shape: initial.shape ?? "wide" } : null);
  const [stats, setStats] = useState<WidgetStat[]>(initial.stats ?? []);
  const [url, setUrl] = useState(initial.link?.url ?? "");
  const [linkLabel, setLinkLabel] = useState(initial.link?.label ?? "");
  const [crop, setCrop] = useState<{ file: File; shape: "wide" | "square" } | null>(null);
  const [uploading, setUploading] = useState<"wide" | "square" | null>(null);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shapeRef = useRef<"wide" | "square">("wide");
  const ids = useId();

  const link = withScheme(url);
  const badLink = linkProblem(link);
  const filled = stats.map((st) => ({ label: st.label.trim(), value: st.value.trim() })).filter((st) => st.label || st.value);
  const halfStat = filled.some((st) => !st.label || !st.value);
  const something = !!text.trim() || !!image || filled.length > 0 || !!link;
  const card: CardWidget = {
    id: initial.id,
    type: "custom",
    title: title.trim(),
    ...(image ? { image: image.id, shape: image.shape } : {}),
    ...(text.trim() ? { text: text.trim() } : {}),
    ...(filled.length ? { stats: filled } : {}),
    ...(link ? { link: { url: link, ...(linkLabel.trim() ? { label: linkLabel.trim() } : {}) } } : {}),
  };
  const problem = !card.title ? t("widgets.card.needsTitle") : !something ? t("widgets.card.needsMore") : halfStat ? t("widgets.card.halfStat") : badLink;
  const finish = () => {
    setTried(true);
    if (problem || uploading) return;
    onDone(card);
  };

  const pick = (shape: "wide" | "square") => {
    shapeRef.current = shape;
    fileRef.current?.click();
  };
  const upload = async (file: Blob, area: { x: number; y: number; w: number; h: number } | null, shape: "wide" | "square") => {
    setUploading(shape);
    try {
      const res = await usersApi.uploadWidgetImage(file, area, shape);
      setImage({ id: res.id, shape });
    } catch (err) {
      toast(describeError(err, t("composer.composer.uploadFailed")), "error");
    } finally {
      setUploading(null);
    }
  };
  const setStat = (i: number, change: Partial<WidgetStat>) => setStats((list) => list.map((st, j) => (j === i ? { ...st, ...change } : st)));

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t("widgets.card.titleNew") : t("widgets.card.titleEdit")}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={finish} disabled={uploading !== null || (tried && !!problem)} data-testid="widget-done">{t("pick.done")}</Button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setCrop({ file: f, shape: shapeRef.current });
          e.target.value = "";
        }}
      />
      <div className={s.stack}>
        <Field label={t("widgets.card.title")} error={tried && !card.title ? t("widgets.card.needsTitle") : null}>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.title} placeholder={t("widgets.card.titlePlaceholder")} autoFocus data-testid="card-title" />
        </Field>

        <div role="group" aria-labelledby={`${ids}-picture`}>
          <span className={s.label} id={`${ids}-picture`}>{t("widgets.card.picture")}</span>
          {image ? (
            <div className={s.picture}>
              <img className={s.pictureImg} data-shape={image.shape} src={widgetImageUrl(image.id, image.shape === "wide" ? 300 : 104)} alt="" />
              <div className={s.chosenBtns}>
                <button className={s.chip} disabled={uploading !== null} onClick={() => pick(image.shape)}>
                  {uploading ? <LoaderCircle size={14} className={s.spin} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />} {t("widgets.changePicture")}
                </button>
                <button className={s.chip} onClick={() => setImage(null)}>{t("widgets.removePicture")}</button>
              </div>
            </div>
          ) : (
            <div className={s.pictures}>
              <button className={s.pick} data-shape="wide" disabled={uploading !== null} onClick={() => pick("wide")} data-testid="card-pick-wide">
                {uploading === "wide" ? <LoaderCircle size={20} className={s.spin} aria-hidden="true" /> : <ImagePlus size={20} aria-hidden="true" />}
                {t("widgets.card.wide")}
              </button>
              <button className={s.pick} data-shape="square" disabled={uploading !== null} onClick={() => pick("square")} data-testid="card-pick-square">
                {uploading === "square" ? <LoaderCircle size={20} className={s.spin} aria-hidden="true" /> : <ImagePlus size={20} aria-hidden="true" />}
                {t("widgets.card.square")}
              </button>
            </div>
          )}
        </div>

        <Field label={t("widgets.card.text")} hint={t("composer.limit.left", { count: LIMITS.text - text.length })}>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} maxLength={LIMITS.text} rows={3} placeholder={t("widgets.card.textPlaceholder")} data-testid="card-text" />
        </Field>

        <div role="group" aria-labelledby={`${ids}-stats`}>
          <span className={s.label} id={`${ids}-stats`}>{t("widgets.card.stats")}</span>
          <p className={s.note} style={{ margin: "-4px 0 8px" }}>{t("widgets.card.statsHint")}</p>
          {stats.length ? (
            <div className={s.statRows}>
              {stats.map((st, i) => (
                <div key={i} className={s.statRow}>
                  <TextInput value={st.label} onChange={(e) => setStat(i, { label: e.target.value })} maxLength={LIMITS.label} placeholder={t("widgets.card.statLabel")} aria-label={t("widgets.card.statLabelN", { n: i + 1 })} />
                  <TextInput value={st.value} onChange={(e) => setStat(i, { value: e.target.value })} maxLength={LIMITS.value} placeholder={t("widgets.card.statValue")} aria-label={t("widgets.card.statValueN", { n: i + 1 })} />
                  <button className={s.iconBtn} aria-label={t("widgets.card.removeStat", { n: i + 1 })} onClick={() => setStats(stats.filter((_, j) => j !== i))}><X size={16} /></button>
                </div>
              ))}
            </div>
          ) : null}
          {stats.length < LIMITS.stats ? (
            <button className={s.chip} style={{ marginTop: stats.length ? 8 : 0 }} onClick={() => setStats([...stats, { label: "", value: "" }])} data-testid="card-add-stat">
              <Plus size={14} aria-hidden="true" /> {t("widgets.card.addStat")}
            </button>
          ) : null}
        </div>

        <div role="group" aria-labelledby={`${ids}-link`}>
          <span className={s.label} id={`${ids}-link`}>{t("widgets.card.link")}</span>
          <div className={s.linkRow}>
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setUrl((v) => withScheme(v))} maxLength={512} placeholder="https://" aria-label={t("widgets.card.linkUrl")} inputMode="url" autoComplete="off" spellCheck={false} invalid={!!url.trim() && !!badLink} data-testid="card-link" />
            <TextInput value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} maxLength={LIMITS.linkLabel} placeholder={t("widgets.card.linkLabel")} aria-label={t("widgets.card.linkLabel")} disabled={!url.trim()} />
          </div>
          {url.trim() && badLink ? <p className={s.error}>{badLink}</p> : null}
        </div>

        <div>
          <span className={s.label}>{t("settings.profile.preview")}</span>
          <div className={s.previewSheet}>
            <ProfileWidgets widgets={[{ ...card, title: card.title || t("widgets.card.titlePlaceholder") }]} variant="modal" />
          </div>
        </div>
        {tried && problem ? <p className={s.error} role="alert">{problem}</p> : null}
      </div>

      {crop ? (
        <ImageCropModal
          file={crop.file}
          aspect={crop.shape === "wide" ? 12 / 5 : 1}
          maxSize={720}
          serverCrop
          title={t("widgets.card.cropTitle")}
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            const shape = crop.shape;
            setCrop(null);
            void upload(blob, area ?? null, shape);
          }}
        />
      ) : null}
    </Modal>
  );
}
