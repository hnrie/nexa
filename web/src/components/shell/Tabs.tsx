import { Hash, Lock, MessageCircle, Plus, Users, Volume2, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { ChannelGlyph } from "@/components/common/ChannelGlyph";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { activeTab, panesIn, usePanes, type Tab } from "@/stores/panes";
import { useReadStates, isUnread } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useUsers } from "@/stores/users";
import { t } from "@/i18n";
import s from "./Panes.module.css";

/** The page under the tab strip, which the open tab names as what it controls. */
export const TAB_PANEL_ID = "shell-tab-panel";

/**
 * The tab strip, which behaves the way a browser's does: click to switch,
 * middle-click or × to close, drag to reorder, and a + on the end.
 *
 * It is not drawn at all while there is one tab holding one pane, which is the
 * shape the app has always had — nobody who does not use tabs should have to
 * look at a row of one.
 */
export function Tabs() {
  const tabs = usePanes((p) => p.tabs);
  const active = usePanes((p) => p.active);
  const panes = usePanes((p) => p.panes);
  const select = usePanes((p) => p.selectTab);
  const close = usePanes((p) => p.closeTab);
  const move = usePanes((p) => p.moveTab);
  const openTab = usePanes((p) => p.openTab);
  const [over, setOver] = useState<number | null>(null);
  const from = useRef<number | null>(null);

  const onlyOne = tabs.length === 1 && panesIn(tabs[0]!.root).length === 1;
  if (onlyOne) return null;

  // Only selecting: the shell notices the focused pane changed and moves the
  // address bar to match, so every way of switching tab goes through one path.
  const go = (tab: Tab) => select(tab.id);

  // One stop in the tab order for the whole strip, on the tab that is open;
  // the arrows move between tabs and Enter opens one, as a tab strip does.
  // Delete closes the tab with focus, the keyboard's way to its close button.
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const list = e.currentTarget.closest('[role="tablist"]');
    const buttons = list ? [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')] : [];
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = e.key === (rtl ? "ArrowLeft" : "ArrowRight") ? (i + 1) % tabs.length : e.key === (rtl ? "ArrowRight" : "ArrowLeft") ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) {
      e.preventDefault();
      buttons[next]?.focus();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && tabs.length > 1) {
      e.preventDefault();
      close(tabs[i]!.id);
      // focus stays in the strip, on the neighbour that took its place
      requestAnimationFrame(() => buttons[Math.min(i, buttons.length - 2)]?.focus());
    }
  };

  return (
    <div className={s.tabs} data-no-swipe="">
      <div className={s.tabList} role="tablist" aria-label={t("panes.tabs")}>
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            className={s.tab}
            data-selected={tab.id === active}
            data-drop={over === i || undefined}
            draggable
            onDragStart={(e) => {
              from.current = i;
              e.dataTransfer.effectAllowed = "move";
              // Firefox will not start a drag without something on the transfer.
              e.dataTransfer.setData("text/plain", tab.id);
            }}
            onDragOver={(e) => {
              if (from.current === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (from.current !== null) move(from.current, i);
              from.current = null;
              setOver(null);
            }}
            onDragEnd={() => {
              from.current = null;
              setOver(null);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(tab.id);
              }
            }}
          >
            <button
              type="button"
              className={s.tabBtn}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={tab.id === active}
              aria-controls={tab.id === active ? TAB_PANEL_ID : undefined}
              aria-keyshortcuts={tabs.length > 1 ? "Delete" : undefined}
              tabIndex={tab.id === active ? 0 : -1}
              onClick={() => go(tab)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <TabLabel tab={tab} />
            </button>
            {/* Beside the tab rather than inside it (a button in a button is
                not allowed), and out of the tab order: Delete on the tab does
                the same from the keyboard. */}
            {tabs.length > 1 ? (
              <button
                type="button"
                className={s.tabClose}
                tabIndex={-1}
                aria-label={t("panes.closeTab")}
                title={t("panes.closeTab")}
                onClick={() => close(tab.id)}
              >
                <X size={13} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        className={s.tabAdd}
        aria-label={t("panes.newTab")}
        title={t("panes.newTab")}
        onClick={() => {
          openTab(null, null);
        }}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

function TabLabel({ tab }: { tab: Tab }) {
  const panes = usePanes((p) => p.panes);
  const byId = useChannels((c) => c.byId);
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const rels = useRelationships((r) => r.byUser);
  const reads = useReadStates((r) => r.byChannel);
  const ids = panesIn(tab.root);
  const focused = panes[tab.focus];
  const channel = focused?.channelId ? byId[focused.channelId] : undefined;
  const unread = ids.some((id) => {
    const ch = panes[id]?.channelId ? byId[panes[id]!.channelId!] : undefined;
    return !!ch?.last_message_id && isUnread(reads[ch.id], ch.last_message_id);
  });

  if (!channel) {
    return (
      <span className={s.tabName} data-unread={unread || undefined}>
        <Users size={14} />
        <span>{t("sidebar.dMSidebar.friends")}</span>
      </span>
    );
  }
  const name = channelDisplayName(channel, users, meId, friendNicknames(rels));
  // A tab holding a split says so, since its label can only name one of them.
  const extra = ids.length > 1 ? ` +${ids.length - 1}` : "";
  return (
    <span className={s.tabName} data-unread={unread || undefined}>
      <TabIcon channel={channel} meId={meId} name={name} />
      <span>{name}{extra}</span>
    </span>
  );
}

function TabIcon({ channel, meId, name }: { channel: Channel; meId: string | undefined; name: string }) {
  const users = useUsers((u) => u.byId);
  if (channel.type === "dm") {
    const other = channel.recipient_ids.find((id) => id !== meId) ?? channel.recipient_ids[0] ?? "";
    return <Avatar id={other} avatarId={users[other]?.avatar_id ?? null} name={name} size={16} />;
  }
  if (channel.type === "group_dm") return <Users size={14} />;
  if (channel.type === "voice") return <ChannelGlyph channel={channel} size={14} />;
  if (channel.type === "subchat") return channel.locked ? <Lock size={14} /> : <MessageCircle size={14} />;
  return <ChannelGlyph channel={channel} size={14} />;
}
