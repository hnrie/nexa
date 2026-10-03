import { ArrowDown, ArrowUp, ExternalLink, LayoutGrid, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import { avatarColor } from "@/lib/avatarColor";
import { gamePicture, isGameWidget, linkHost, MAX_WIDGETS, widgetImageUrl, type CardWidget, type GameWidget, type Widget, type WidgetGame } from "@/lib/widgets";
import { t } from "@/i18n";
import s from "./Widgets.module.css";

type Variant = "modal" | "panel";

/**
 * The widgets as the profile designer draws them (Settings, Profiles): each
 * with its tools (change it, move it, take it off, put it on the profile
 * card) and, after them, the way to add another.
 */
export interface WidgetDesign {
  edit: (id: string) => void;
  move: (id: string, delta: number) => void;
  remove: (id: string) => void;
  /** Puts a widget first, which is the one the profile card shows. */
  feature: (id: string) => void;
  add: () => void;
}

/** One widget in the designer: pressing it changes it, and its tools sit along its top. */
function Designed({ w, index, count, design, children }: { w: Widget; index: number; count: number; design: WidgetDesign; children: ReactNode }) {
  const name = isGameWidget(w) ? widgetTitle(w) : w.title;
  return (
    <div className={s.designed} data-first={index === 0 || undefined} data-testid={`designed-${w.type}`}>
      {children}
      <button type="button" className={s.designSpot} aria-label={t("designer.widget.edit", { name })} onClick={() => design.edit(w.id)} />
      <div className={s.tools} role="toolbar" aria-label={t("designer.widget.tools", { name })}>
        {index === 0 ? (
          <span className={s.onCard}><Pin size={12} aria-hidden="true" /> {t("designer.widget.onCard")}</span>
        ) : (
          <button type="button" className={s.toolText} onClick={() => design.feature(w.id)}>
            <Pin size={12} aria-hidden="true" /> {t("designer.widget.showOnCard")}
          </button>
        )}
        <button type="button" className={s.tool} aria-label={t("designer.widget.editShort")} title={t("designer.widget.editShort")} onClick={() => design.edit(w.id)}><Pencil size={14} /></button>
        <button type="button" className={s.tool} aria-label={t("reorder.moveUp")} title={t("reorder.moveUp")} disabled={index === 0} onClick={() => design.move(w.id, -1)}><ArrowUp size={14} /></button>
        <button type="button" className={s.tool} aria-label={t("reorder.moveDown")} title={t("reorder.moveDown")} disabled={index === count - 1} onClick={() => design.move(w.id, 1)}><ArrowDown size={14} /></button>
        <button type="button" className={s.tool} data-danger="" aria-label={t("widgets.remove")} title={t("widgets.remove")} onClick={() => design.remove(w.id)}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

/** What each kind of games widget is called, on a profile and in the editor. */
export function widgetTitle(w: Pick<Widget, "type">): string {
  switch (w.type) {
    case "favorite":
      return t("widgets.type.favorite");
    case "playing":
      return t("widgets.type.playing");
    case "wishlist":
      return t("widgets.type.wishlist");
    case "played":
      return t("widgets.type.played");
    default:
      return t("widgets.type.custom");
  }
}

/**
 * A game's box: its cover from IGDB, or the picture its owner put up, or its
 * name on a colour of its own when it has neither (or its picture would not
 * load). `named` says the box stands alone, so it carries the game's name;
 * beside the name it is only a picture.
 */
export function GameCover({ game, css, named, className }: { game: WidgetGame; css: number; named?: boolean; className?: string }) {
  const src = gamePicture(game, css);
  const [broken, setBroken] = useState<string | null>(null);
  const shown = src && broken !== src ? src : null;
  return (
    <span
      className={[s.cover, className ?? ""].join(" ")}
      style={{ "--cover-tint": avatarColor(game.name) } as CSSProperties}
      {...(named ? { role: "img", "aria-label": game.name } : { "aria-hidden": true })}
    >
      {shown ? <img src={shown} alt="" loading="lazy" draggable={false} onError={() => setBroken(shown)} /> : <span className={s.coverName} dir="auto">{game.name}</span>}
    </span>
  );
}

function Favorite({ w, variant }: { w: GameWidget; variant: Variant }) {
  const game = w.games[0];
  if (!game) return null;
  const glow = gamePicture(game, 40);
  return (
    <section className={[s.widget, s.favorite].join(" ")} data-testid="widget-favorite">
      {glow ? <span className={s.glow} style={{ backgroundImage: `url("${glow}")` }} aria-hidden="true" /> : null}
      <GameCover game={game} css={variant === "panel" ? 56 : 76} />
      <div className={s.favText}>
        <h3>{t("widgets.type.favorite")}</h3>
        <span className={s.favName} dir="auto">{game.name}</span>
        {w.note ? <p className={s.favNote} dir="auto">{w.note}</p> : null}
      </div>
    </section>
  );
}

function Playing({ w }: { w: GameWidget }) {
  return (
    <section className={s.widget} data-testid="widget-playing">
      <h3>{t("widgets.type.playing")}</h3>
      <ul className={s.rows}>
        {w.games.map((g, i) => (
          <li key={`${g.id ?? g.name}-${i}`} className={s.row}>
            <GameCover game={g} css={36} />
            <div className={s.rowText}>
              <span className={s.rowName} dir="auto">{g.name}</span>
              {g.tags?.length ? (
                <ul className={s.tags} aria-label={t("widgets.howTheyPlay")}>
                  {g.tags.map((tag) => <li key={tag} className={s.tag} dir="auto">{tag}</li>)}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Shelf({ w, variant, onShowAll }: { w: GameWidget; variant: Variant; onShowAll?: (() => void) | undefined }) {
  const [all, setAll] = useState(false);
  // two rows of boxes on the full profile, one row where the rest are on the full profile (onShowAll)
  const most = variant === "panel" ? 4 : onShowAll ? 6 : 12;
  const shown = all ? w.games : w.games.slice(0, most);
  const title = widgetTitle(w);
  return (
    <section className={[s.widget, s.shelfWrap].join(" ")} data-testid={`widget-${w.type}`}>
      <div className={s.head}>
        <h3>{title}</h3>
        <span className={s.count} aria-label={t("widgets.gameCount", { count: w.games.length })}>{w.games.length.toLocaleString()}</span>
      </div>
      <ul className={s.shelf} aria-label={title}>
        {shown.map((g, i) => (
          <li key={`${g.id ?? g.name}-${i}`}>
            <Tooltip text={g.name} className={s.tip}>
              <GameCover game={g} css={80} named />
            </Tooltip>
            <span className={s.caption} aria-hidden="true" dir="auto">{g.name}</span>
          </li>
        ))}
      </ul>
      {w.games.length > most ? (
        onShowAll ? (
          // the preview stays short: the rest are on the full profile
          <button className={s.more} onClick={onShowAll}>{t("widgets.showAll")}</button>
        ) : (
          <button className={s.more} onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? t("widgets.showFewer") : t("widgets.showAll")}
          </button>
        )
      ) : null}
    </section>
  );
}

function Card({ w, variant }: { w: CardWidget; variant: Variant }) {
  const wide = w.image && w.shape !== "square" ? w.image : null;
  const square = w.image && w.shape === "square" ? w.image : null;
  const host = w.link ? linkHost(w.link.url) : "";
  // a link with words of its own also says where it goes, as a masked link in a message does
  const showHost = !!w.link?.label && !w.link.label.toLowerCase().includes(host.toLowerCase());
  return (
    <section className={[s.widget, s.card].join(" ")} data-testid="widget-custom">
      {wide ? <img className={s.cardImg} src={widgetImageUrl(wide, variant === "panel" ? 300 : 520)} alt="" loading="lazy" draggable={false} /> : null}
      <div className={s.cardBody}>
        <div className={s.cardTop}>
          {square ? <img className={s.cardSquare} src={widgetImageUrl(square, 56)} alt="" loading="lazy" draggable={false} /> : null}
          <h3 className={s.cardTitle} dir="auto">{w.title}</h3>
        </div>
        {w.text ? <p className={s.cardText} dir="auto">{w.text}</p> : null}
        {w.stats?.length ? (
          <dl className={s.stats}>
            {w.stats.map((st, i) => (
              <div key={i} className={s.stat}>
                <dt dir="auto">{st.label}</dt>
                <dd dir="auto">{st.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {w.link ? (
          <a className={s.link} href={w.link.url} target="_blank" rel="noopener noreferrer nofollow ugc" data-testid="widget-link">
            <ExternalLink size={14} aria-hidden="true" />
            <span className={s.linkText} dir="auto">{w.link.label || host}</span>
            {showHost ? <span className={s.linkHost} dir="ltr">{host}</span> : null}
          </a>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Someone's widgets, in the order they put them, laid into their profile's
 * sheet. On their own full profile with none yet, what they could show and
 * the way to Settings. `onShowAll` sends a shelf's Show All somewhere else
 * (the full profile) instead of opening it where it is.
 */
export function ProfileWidgets({ widgets, variant, onAdd, onShowAll, design }: { widgets: Widget[]; variant: Variant; onAdd?: (() => void) | undefined; onShowAll?: (() => void) | undefined; design?: WidgetDesign | undefined }) {
  if (widgets.length === 0) {
    if (!onAdd) return null;
    return (
      <div className={s.empty} data-testid="profile-widgets-empty">
        <p className={s.emptyText}>{t("widgets.emptyOwn")}</p>
        <button className={s.emptyBtn} onClick={onAdd}>
          <LayoutGrid size={15} aria-hidden="true" /> {t("widgets.add")}
        </button>
      </div>
    );
  }
  const draw = (w: Widget) => {
    if (!isGameWidget(w)) return <Card key={w.id} w={w} variant={variant} />;
    if (w.type === "favorite") return <Favorite key={w.id} w={w} variant={variant} />;
    if (w.type === "playing") return <Playing key={w.id} w={w} />;
    return <Shelf key={w.id} w={w} variant={variant} onShowAll={onShowAll} />;
  };
  return (
    <div className={s.board} data-variant={variant} data-testid="profile-widgets">
      {design
        ? widgets.map((w, i) => (
            <Designed key={w.id} w={w} index={i} count={widgets.length} design={design}>
              {draw(w)}
            </Designed>
          ))
        : widgets.map(draw)}
      {design && widgets.length < MAX_WIDGETS ? (
        <button type="button" className={s.addTile} onClick={design.add} data-testid="designer-add-widget">
          <Plus size={16} aria-hidden="true" /> {t("widgets.addOne")}
        </button>
      ) : null}
    </div>
  );
}
