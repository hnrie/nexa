import { useMediaAnimation } from "@/lib/mediaAnimation";
import { CalendarDays, ChevronRight, Download, Gavel, Search, Server, Smile, Sticker as StickerIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { moderation as modApi, type ModPack, type ModServerRef, type ModUpload, type PackScope, type PackSort, type People } from "@/api/moderation";
import type { Emoji, Sticker } from "@/api/types";
import { emojiUrl, stickerUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { Spinner } from "@/components/common/Spinner";
import { Tooltip } from "@/components/common/Tooltip";
import { StickerView } from "@/components/stickers/StickerView";
import { t } from "@/i18n";
import { personName, previewText } from "@/lib/moderation";
import { formatRelative, formatShortDate } from "@/lib/time";
import { useModEvents, useModeration } from "@/stores/moderation";
import { ModerateEmojiModal } from "./ModerateEmojiModal";
import { ModeratePackModal, type PackPreset } from "./ModeratePackModal";
import { ServerIcon } from "./ProfileSheet";
import m from "./Moderation.module.css";
import p from "./Sheet.module.css";
import x from "./Expressions.module.css";

const PAGE = 48;
const BASE = "/channels/@admin/expressions";

/** Why the viewer cannot act on a pack, in a sentence ("" when they can). */
export function packBlockedText(b: ModPack["blocked"]): string {
  switch (b) {
    case "self":
      return t("moderation.packs.blockedSelf");
    case "owner":
      return t("moderation.packs.blockedOwner");
    case "staff":
      return t("moderation.packs.blockedStaff");
    case "":
      return "";
    default:
      return t("moderation.packs.blockedOther");
  }
}

/**
 * One sticker or emoji as the panel draws it: still until pointed at, as a
 * grid of them is everywhere else, so a page of animated stickers does not
 * play all at once.
 */
export function ExpressionPic({ kind, blobId, format, name, size }: { kind: "sticker" | "emoji"; blobId: string; format?: string | undefined; name: string; size: number }) {
  useMediaAnimation();
  const [play, setPlay] = useState(false);
  const src = kind === "emoji" ? emojiUrl(blobId, false, size) : stickerUrl(blobId, size);
  return (
    <span style={{ display: "contents" }} onPointerEnter={() => setPlay(true)} onPointerLeave={() => setPlay(false)}>
      {kind === "emoji" ? <img src={src} alt={name} loading="lazy" decoding="async" draggable={false} /> : <StickerView format={format} src={src} alt={name} play={play} renderer="canvas" />}
    </span>
  );
}

/** A pack's first stickers, in place of a banner: a card's, or the taller one on its page. */
export function PackMosaic({ pack, tall = false }: { pack: ModPack; tall?: boolean }) {
  const first = pack.stickers.slice(0, 4);
  return (
    <div className={x.mosaic} data-count={Math.max(1, first.length)} data-kind={pack.kind} data-tall={tall || undefined} aria-hidden="true">
      {first.length ? (
        first.map((s) => (
          <span key={s.id} className={x.mosaicCell}>
            <ExpressionPic kind={pack.kind === "emoji" ? "emoji" : "sticker"} blobId={s.blob_id} format={s.format} name={s.name} size={pack.kind === "emoji" ? 48 : 96} />
          </span>
        ))
      ) : (
        <span className={`${x.mosaicCell} ${x.mosaicEmpty}`}>
          <StickerIcon size={28} />
        </span>
      )}
    </div>
  );
}

/** Whose a pack is: the person, or the server and so its owner. */
export function PackWhose({ pack, people, servers, onPerson, onServer }: { pack: ModPack; people: People; servers: Record<string, ModServerRef>; onPerson: (id: string) => void; onServer: (id: string) => void }) {
  if (pack.server_id) {
    const srv = servers[pack.server_id];
    return (
      <button type="button" className={x.whose} onClick={() => onServer(pack.server_id!)} data-testid="pack-whose">
        <ServerIcon id={pack.server_id} iconId={srv?.icon_id ?? null} name={srv?.name ?? ""} size={18} />
        <span>{t("moderation.packs.inServer", { name: srv?.name ?? t("moderation.packs.unknownServer") })}</span>
      </button>
    );
  }
  const owner = people[pack.owner_id];
  return (
    <button type="button" className={x.whose} onClick={() => onPerson(pack.owner_id)} data-testid="pack-whose">
      <Avatar id={pack.owner_id} avatarId={owner?.avatar_id ?? null} name={personName(owner)} size={18} />
      <span>{t("moderation.servers.ownedBy", { name: personName(owner) })}</span>
    </button>
  );
}

/** The tags in a pack's corner: an emoji pack, public, or kept private by the staff. */
export function PackFlags({ pack }: { pack: ModPack }) {
  return (
    <div className={x.packFlags}>
      {pack.kind === "emoji" ? <span className={m.flag}>{t("moderation.packs.emojiPack")}</span> : null}
      {pack.discover_blocked ? (
        <span className={m.flag} data-tone="warn">{t("moderation.packs.keptPrivate")}</span>
      ) : pack.public ? (
        <span className={m.flag}>{t("moderation.packs.public")}</span>
      ) : null}
    </div>
  );
}

/**
 * Stickers and emoji, for the staff: every pack on Nexa, anyone's or any
 * server's, public or not, and the newest uploads as a wall of pictures. A
 * server's emoji are taken down from its page in the Servers tab, or from
 * here when they turn up among the newest.
 */
export function ExpressionsTab() {
  const loc = useLocation();
  const nav = useNavigate();
  const view = loc.pathname.startsWith(`${BASE}/uploads`) ? "uploads" : "packs";
  const scroller = useRef<HTMLDivElement>(null);
  // the other view starts at its top, not as far down as this one was read
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [view]);
  return (
    <div className={m.scroll} ref={scroller} data-testid="expressions-tab">
      <div className={x.views} role="tablist" aria-label={t("moderation.tabs.expressions")}>
        <button type="button" role="tab" aria-selected={view === "packs"} className={m.chip} data-selected={view === "packs"} onClick={() => nav(BASE)} data-testid="expressions-view-packs">
          <StickerIcon size={15} aria-hidden="true" /> {t("moderation.packs.viewPacks")}
        </button>
        <button type="button" role="tab" aria-selected={view === "uploads"} className={m.chip} data-selected={view === "uploads"} onClick={() => nav(`${BASE}/uploads`)} data-testid="expressions-view-uploads">
          <Smile size={15} aria-hidden="true" /> {t("moderation.packs.viewUploads")}
        </button>
      </div>
      {view === "packs" ? <PackList scroller={scroller} /> : <UploadWall />}
    </div>
  );
}

function PackList({ scroller }: { scroller: RefObject<HTMLDivElement> }) {
  const nav = useNavigate();
  const mergePeople = useModeration((s) => s.mergePeople);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<PackScope>("all");
  const [sort, setSort] = useState<PackSort>("newest");
  const [packs, setPacks] = useState<ModPack[] | null>(null);
  const [people, setPeople] = useState<People>({});
  const [servers, setServers] = useState<Record<string, ModServerRef>>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moderating, setModerating] = useState<ModPack | null>(null);
  const request = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (offset: number) => {
      const id = ++request.current;
      setLoading(true);
      setFailed(false);
      try {
        const r = await modApi.packs({ q, scope, sort, offset, limit: PAGE });
        if (id !== request.current) return;
        setPacks((cur) => (offset ? [...(cur ?? []), ...r.packs.filter((pk) => !cur?.some((y) => y.id === pk.id))] : r.packs));
        setPeople((cur) => ({ ...cur, ...r.people }));
        setServers((cur) => ({ ...cur, ...r.servers }));
        mergePeople(r.people);
        setMore(r.has_more);
        // a list that starts again is read from its top, not from where the old one was left
        if (!offset) scroller.current?.scrollTo({ top: 0 });
      } catch {
        if (id === request.current) setFailed(true);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [q, scope, sort, mergePeople, scroller],
  );

  // A new search, filter or order starts the list again (typing waits a
  // moment). The old list's pages stop at once, so none lands in the new one.
  useEffect(() => {
    request.current++;
    setMore(false);
    const h = setTimeout(() => {
      setPacks(null);
      void load(0);
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [q, scope, sort, load]);

  // the next page loads as the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || failed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) void load(packs?.length ?? 0);
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loading, load, failed, packs?.length]);

  /** Reads one pack again after something happened to it; a pack that went leaves the list. */
  const refresh = useCallback(async (id: string) => {
    try {
      const r = await modApi.pack(id);
      setPacks((cur) => cur?.map((pk) => (pk.id === id ? r.pack : pk)) ?? cur);
    } catch {
      setPacks((cur) => cur?.filter((pk) => pk.id !== id) ?? cur);
    }
  }, []);

  useModEvents((e) => {
    const pid = e.type === "case" && e.case.action === "expression_takedown" ? e.case.details.pack_id : undefined;
    if (pid && packs?.some((pk) => pk.id === pid)) void refresh(pid);
  });

  const scopes: { id: PackScope; label: string }[] = [
    { id: "all", label: t("moderation.packs.scopeAll") },
    { id: "discover", label: t("moderation.packs.scopePublic") },
    { id: "personal", label: t("moderation.packs.scopePersonal") },
    { id: "server", label: t("moderation.packs.scopeServer") },
    { id: "hidden", label: t("moderation.packs.scopeKeptPrivate") },
  ];

  return (
    <>
      <div className={m.toolbar}>
        <label className={m.search}>
          <Search size={17} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("moderation.packs.search")} aria-label={t("moderation.packs.search")} data-testid="packs-search" />
        </label>
        <div className={m.chips} role="radiogroup" aria-label={t("moderation.packs.scopeLabel")}>
          {scopes.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={scope === s.id} className={m.chip} data-selected={scope === s.id} onClick={() => setScope(s.id)} data-testid={`packs-scope-${s.id}`}>
              {s.label}
            </button>
          ))}
        </div>
        <Select className={m.sort} value={sort} onChange={(e) => setSort(e.target.value as PackSort)} aria-label={t("moderation.sort.label")}>
          <option value="newest">{t("moderation.sort.newest")}</option>
          <option value="oldest">{t("moderation.sort.oldest")}</option>
          <option value="installs">{t("moderation.packs.sortInstalls")}</option>
          <option value="name">{t("moderation.packs.sortName")}</option>
        </Select>
      </div>

      {packs === null && !failed ? (
        <div className={m.grid} aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={m.skeleton} />
          ))}
        </div>
      ) : null}
      {failed && !packs?.length ? (
        <div className={m.empty}>
          <p>{t("moderation.loadFailed")}</p>
          <Button size="sm" variant="secondary" onClick={() => void load(0)}>
            {t("moderation.retry")}
          </Button>
        </div>
      ) : null}
      {packs && packs.length === 0 ? (
        <div className={m.empty}>
          <StickerIcon size={40} aria-hidden="true" />
          <span className={m.emptyTitle}>{q || scope !== "all" ? t("moderation.noMatches") : t("moderation.packs.none")}</span>
          {q || scope !== "all" ? (
            <Button size="sm" variant="secondary" onClick={() => { setQ(""); setScope("all"); }}>
              {t("moderation.clearFilters")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {packs && packs.length > 0 ? (
        <div className={m.grid}>
          {packs.map((pk) => (
            <PackCard key={pk.id} pack={pk} people={people} servers={servers} onModerate={() => setModerating(pk)} onOpen={() => nav(`${BASE}/packs/${pk.id}`)} onPerson={(id) => nav(`/channels/@admin/users/${id}`)} onServer={(id) => nav(`/channels/@admin/servers/${id}`)} />
          ))}
        </div>
      ) : null}
      <div ref={sentinel} className={m.sentinel} />
      {loading && packs ? (
        <div className={m.loadingRow}>
          <Spinner size={24} label={t("chat.pins.loading")} />
        </div>
      ) : null}
      {moderating ? <ModeratePackModal pack={moderating} owner={people[moderating.owner_id]} server={moderating.server_id ? servers[moderating.server_id] : undefined} onClose={() => setModerating(null)} onDone={() => void refresh(moderating.id)} /> : null}
    </>
  );
}

function PackCard({ pack, people, servers, onModerate, onOpen, onPerson, onServer }: { pack: ModPack; people: People; servers: Record<string, ModServerRef>; onModerate: () => void; onOpen: () => void; onPerson: (id: string) => void; onServer: (id: string) => void }) {
  const blocked = packBlockedText(pack.blocked);
  const moderate = (
    <Button size="sm" variant="primary" onClick={onModerate} disabled={!!blocked} data-testid="pack-card-moderate">
      <Gavel size={15} aria-hidden="true" /> {t("moderation.moderate")}
    </Button>
  );
  return (
    <article className={m.card} data-testid="pack-card" data-pack={pack.id}>
      <PackMosaic pack={pack} />
      <PackFlags pack={pack} />
      <div className={`${m.cardBody} ${x.packBody}`}>
        <div className={m.cardName}>
          <span className={m.cardNameText} dir="auto">{pack.name}</span>
        </div>
        <PackWhose pack={pack} people={people} servers={servers} onPerson={onPerson} onServer={onServer} />
        <p className={m.cardAbout} data-empty={!pack.description || undefined} dir="auto">
          {pack.description ? previewText(pack.description) : t("moderation.servers.noDescription")}
        </p>
        <div className={m.cardMeta}>
          <span>
            {pack.kind === "emoji" ? <Smile size={13} aria-hidden="true" /> : <StickerIcon size={13} aria-hidden="true" />}
            {pack.kind === "emoji" ? t("moderation.packs.emojiCount", { count: pack.sticker_count }) : t("moderation.packs.stickerCount", { count: pack.sticker_count })}
          </span>
          <span>
            <Download size={13} aria-hidden="true" />
            {t("moderation.packs.installs", { count: pack.installs })}
          </span>
          <span>
            <CalendarDays size={13} aria-hidden="true" />
            {formatShortDate(pack.created_at)}
          </span>
        </div>
        <div className={m.cardActions}>
          {blocked ? (
            <Tooltip text={blocked}>
              <span className={m.tipWrap} tabIndex={0}>
                {moderate}
              </span>
            </Tooltip>
          ) : (
            moderate
          )}
          <Button size="sm" variant="secondary" onClick={onOpen} data-testid="pack-card-open">
            <StickerIcon size={15} aria-hidden="true" /> {t("moderation.servers.open")}
          </Button>
        </div>
        {blocked ? <p className={m.blockedNote} aria-hidden="true">{blocked}</p> : null}
      </div>
    </article>
  );
}

/** What a takedown from the wall needs: the one sticker's pack, or the one emoji's server. */
type WallTarget = { kind: "sticker"; pack: ModPack; preset: PackPreset } | { kind: "emoji"; serverId: string; emoji: Emoji };

/**
 * The newest stickers and emoji on Nexa, newest first, as a wall to look
 * over. A tile opens where it lives (its pack, or its server); its corner
 * button takes it down there and then.
 */
function UploadWall() {
  const nav = useNavigate();
  const mergePeople = useModeration((s) => s.mergePeople);
  const [items, setItems] = useState<ModUpload[] | null>(null);
  const [people, setPeople] = useState<People>({});
  const [servers, setServers] = useState<Record<string, ModServerRef>>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<WallTarget | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const request = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (after: ModUpload | null) => {
      const id = ++request.current;
      setLoading(true);
      setFailed(false);
      try {
        const r = await modApi.uploads(after ? { before: after.created_at, before_id: after.id, limit: 96 } : { limit: 96 });
        if (id !== request.current) return;
        setItems((cur) => (after ? [...(cur ?? []), ...r.uploads] : r.uploads));
        setPeople((cur) => ({ ...cur, ...r.people }));
        setServers((cur) => ({ ...cur, ...r.servers }));
        mergePeople(r.people);
        setMore(r.has_more);
      } catch {
        if (id === request.current) setFailed(true);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [mergePeople],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || failed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading && items?.length) void load(items[items.length - 1]!);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loading, load, failed, items]);

  /** Opens the takedown for one tile: its pack is read first, for the modal's view of it. */
  const takeDown = async (u: ModUpload) => {
    if (u.kind === "emoji") {
      setTarget({ kind: "emoji", serverId: u.server_id!, emoji: { id: u.id, server_id: u.server_id!, name: u.name, blob_id: u.blob_id, animated: u.animated, creator_id: u.creator_id, created_at: u.created_at } });
      return;
    }
    setOpening(u.id);
    try {
      const r = await modApi.pack(u.pack_id!);
      setServers((cur) => ({ ...cur, ...r.servers }));
      setPeople((cur) => ({ ...cur, ...r.people }));
      setTarget({ kind: "sticker", pack: r.pack, preset: { stickers: [u.id] } });
    } catch {
      // gone already: the wall shows what is left
      setItems((cur) => cur?.filter((x) => x.id !== u.id) ?? cur);
    } finally {
      setOpening(null);
    }
  };
  const gone = (ids: string[]) => setItems((cur) => cur?.filter((x) => !ids.includes(x.id)) ?? cur);

  return (
    <>
      {items === null && !failed ? (
        <div className={x.wall} aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className={m.skeleton} style={{ height: 196 }} />
          ))}
        </div>
      ) : null}
      {failed && !items?.length ? (
        <div className={m.empty}>
          <p>{t("moderation.loadFailed")}</p>
          <Button size="sm" variant="secondary" onClick={() => void load(null)}>
            {t("moderation.retry")}
          </Button>
        </div>
      ) : null}
      {items && items.length === 0 ? (
        <div className={m.empty}>
          <Smile size={40} aria-hidden="true" />
          <span className={m.emptyTitle}>{t("moderation.packs.noUploads")}</span>
        </div>
      ) : null}
      {items && items.length > 0 ? (
        <div className={x.wall} data-testid="uploads-wall">
          {items.map((u) => {
            const srv = u.server_id ? servers[u.server_id] : undefined;
            const owner = u.owner_id ? people[u.owner_id] : undefined;
            const where = u.kind === "emoji" ? t("moderation.packs.inServer", { name: srv?.name ?? t("moderation.packs.unknownServer") }) : srv ? t("moderation.packs.inPackOfServer", { pack: u.pack_name ?? "", server: srv.name }) : t("moderation.packs.inPackOf", { pack: u.pack_name ?? "", name: personName(owner) });
            const open = () => nav(u.kind === "emoji" ? `/channels/@admin/servers/${u.server_id}` : `${BASE}/packs/${u.pack_id}`);
            return (
              <article key={`${u.kind}:${u.id}`} className={x.upload} data-testid="upload-tile" data-kind={u.kind}>
                <div className={x.uploadPic} data-kind={u.kind} onClick={open} role="link" tabIndex={-1} aria-label={where}>
                  <ExpressionPic kind={u.kind} blobId={u.blob_id} format={u.format} name={u.name} size={u.kind === "emoji" ? 64 : 160} />
                </div>
                <span className={`${m.flag} ${x.kindTag}`}>{u.kind === "emoji" ? t("moderation.packs.kindEmoji") : t("moderation.packs.kindSticker")}</span>
                <Tooltip text={t("moderation.packs.takeDownNamed", { name: u.name })} className={x.uploadTakeAt}>
                  <button type="button" className={x.uploadTake} onClick={() => void takeDown(u)} disabled={opening === u.id} aria-label={t("moderation.packs.takeDownNamed", { name: u.name })} data-testid="upload-take-down">
                    <Gavel size={15} aria-hidden="true" />
                  </button>
                </Tooltip>
                <div className={x.uploadInfo}>
                  <span className={x.uploadName} dir="auto">{u.kind === "emoji" ? `:${u.name}:` : u.name}</span>
                  <button type="button" className={x.uploadWhere} onClick={open} data-testid="upload-where">
                    {u.kind === "emoji" || srv ? <Server size={12} aria-hidden="true" /> : <StickerIcon size={12} aria-hidden="true" />}
                    <span dir="auto">{where}</span>
                  </button>
                  <span className={x.uploadWhen}>{formatRelative(u.created_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      <div ref={sentinel} className={m.sentinel} />
      {loading && items ? (
        <div className={m.loadingRow}>
          <Spinner size={24} label={t("chat.pins.loading")} />
        </div>
      ) : null}
      {target?.kind === "sticker" ? (
        <ModeratePackModal
          pack={target.pack}
          owner={people[target.pack.owner_id]}
          server={target.pack.server_id ? servers[target.pack.server_id] : undefined}
          preset={target.preset}
          onClose={() => setTarget(null)}
          onDone={(_c, removed) => gone(removed)}
        />
      ) : null}
      {target?.kind === "emoji" ? (
        <ModerateEmojiModal
          server={servers[target.serverId] ?? { id: target.serverId, name: "", icon_id: null, owner_id: "" }}
          owner={people[servers[target.serverId]?.owner_id ?? ""]}
          emojis={[target.emoji]}
          onClose={() => setTarget(null)}
          onDone={() => gone([target.emoji.id])}
        />
      ) : null}
    </>
  );
}

/** A small picture of a pack for a row, or a bigger one for its page's header: its cover, or its first sticker. */
export function PackCover({ pack, big = false }: { pack: ModPack; big?: boolean }) {
  const cover = pack.stickers.find((s) => s.id === pack.cover_sticker_id) ?? pack.stickers[0];
  return (
    <span className={big ? x.cover : x.packCover} aria-hidden="true">
      {cover ? <ExpressionPic kind={pack.kind === "emoji" ? "emoji" : "sticker"} blobId={cover.blob_id} format={cover.format} name={cover.name} size={big ? 96 : 48} /> : <StickerIcon size={big ? 22 : 18} />}
    </span>
  );
}

/** Packs as rows that open their page, on a person's or a server's page. */
export function PackRows({ packs, onOpen }: { packs: ModPack[]; onOpen: (id: string) => void }) {
  return (
    <ul className={p.rows}>
      {packs.map((pk) => (
        <li key={pk.id}>
          <button type="button" className={p.serverRow} onClick={() => onOpen(pk.id)} data-testid="pack-row">
            <PackCover pack={pk} />
            <span className={p.serverText}>
              <span className={p.serverName} dir="auto">{pk.name}</span>
              <span className={p.serverMeta}>
                {pk.kind === "emoji" ? t("moderation.packs.emojiCount", { count: pk.sticker_count }) : t("moderation.packs.stickerCount", { count: pk.sticker_count })}
                {pk.discover_blocked ? ` · ${t("moderation.packs.keptPrivate")}` : pk.public ? ` · ${t("moderation.packs.public")}` : ""}
              </span>
            </span>
            <ChevronRight size={18} className={p.flip} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Stickers as a takedown's modal shows them: a row of small pictures. */
export function StickerThumbs({ stickers, kind, max = 12 }: { stickers: Pick<Sticker, "id" | "blob_id" | "format" | "name">[]; kind: "sticker" | "emoji"; max?: number }) {
  return (
    <div className={x.thumbs}>
      {stickers.slice(0, max).map((s) => (
        <span key={s.id} className={x.thumb} title={s.name}>
          <ExpressionPic kind={kind} blobId={s.blob_id} format={s.format} name={s.name} size={48} />
        </span>
      ))}
      {stickers.length > max ? <span className={x.thumbMore}>+{stickers.length - max}</span> : null}
    </div>
  );
}
