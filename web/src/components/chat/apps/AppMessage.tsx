import { Eye } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { emojiUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Tooltip, coarsePointer } from "@/components/common/Tooltip";
import { Twemoji } from "@/components/common/Twemoji";
import { Tr, t } from "@/i18n";
import { dismiss, interact } from "@/lib/interactions";
import { findMembers } from "@/lib/pickables";
import { SelectBox } from "@/components/apps/SelectBox";
import { entityChoices, entityKindOfComponent, entityLabel } from "@/components/apps/entityChoices";
import type { DecryptedMessage } from "@/lib/decrypt";
import {
  BUTTON_DANGER,
  BUTTON_PREMIUM,
  BUTTON_PRIMARY,
  BUTTON_SUCCESS,
  C_STRING_SELECT,
  commandInvocation,
  type HookComponent,
  type HookEmoji,
  type HookInteraction,
} from "@/lib/webhookMessage";
import { useAppCommands } from "@/stores/appCommands";
import { useChannels } from "@/stores/channels";
import { openProfilePopout } from "@/stores/profilePopout";
import { useServers } from "@/stores/servers";
import { useUsers, displayName } from "@/stores/users";
import { useShownName } from "../useShownName";
import c from "../Chat.module.css";
import s from "./Apps.module.css";

/**
 * The parts of an app's message that do something or say something no other
 * message does: who used what to bring it, the app still thinking, the line
 * under an answer only you see, and the buttons and select menus the app
 * answers. The rest of an app's message is drawn as a webhook's is
 * (webhook/HookBody), since it comes in the same shape.
 */

/** The message whose parts are being drawn, and whether its buttons and menus can be used. */
interface AppMsgValue {
  msg: DecryptedMessage;
  interactive: boolean;
}

export const AppMsg = createContext<AppMsgValue | null>(null);

export function AppMsgProvider({ msg, interactive, children }: AppMsgValue & { children: ReactNode }) {
  const value = useMemo(() => ({ msg, interactive }), [msg, interactive]);
  return <AppMsg.Provider value={value}>{children}</AppMsg.Provider>;
}

/** What brought the message, when it answers a command (a form's answer counts as its command's). */
export function usedCommand(it: HookInteraction | undefined): HookInteraction | null {
  if (!it) return null;
  if (it.type === 2 && it.name) return it;
  if (it.type === 5 && it.trigger?.type === 2 && it.trigger.name) return { ...it.trigger, user_id: it.user_id };
  return null;
}

/**
 * The line over an app's answer to a command: who used which command. The
 * name opens their profile; the command, a slash command, starts in the
 * message box, for using it too.
 */
export function InteractionLine({ msg, it }: { msg: DecryptedMessage; it: HookInteraction }) {
  const user = useUsers((u) => u.byId[it.user_id]);
  const name = useShownName(msg.channel_id, it.user_id);
  const slash = (it.command_type ?? 1) === 1;
  const command = slash ? `/${it.name}` : it.name!;
  const serverId = useChannels((ch) => ch.byId[msg.channel_id]?.server_id ?? undefined);
  const serverRoles = useServers((sv) => (serverId ? sv.byId[serverId]?.roles : undefined));
  const invocation = commandInvocation(it, (type, id) => {
    // a mentionable is a person or a role
    if (type === 6 || type === 9) {
      const u = useUsers.getState().byId[id];
      if (u) return `@${displayName(u)}`;
    }
    if (type === 8 || type === 9) {
      const r = serverRoles?.[id];
      if (r) return `@${r.name}`;
    }
    if (type === 7) {
      const ch = useChannels.getState().byId[id];
      if (ch?.name) return `#${ch.name}`;
    }
    return undefined;
  });
  const hasOptions = invocation !== command;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const appId = msg.hook?.application_id;
  return (
    <div className={[c.replyLine, s.used].join(" ")} data-testid="interaction-line">
      <span className={c.replyAvatar} aria-hidden="true">
        <Avatar id={it.user_id} avatarId={user?.avatar_id ?? null} name={name} size={16} />
      </span>
      <span className={s.usedText}>
        <Tr
          id="apps.used"
          values={{
            name: (
              <button type="button" className={c.replyName} dir="auto" onClick={(e) => openProfilePopout(it.user_id, e.currentTarget, serverId)}>
                {name}
              </button>
            ),
            command:
              slash && appId ? (
                <Tooltip text={hasOptions ? invocation : t("apps.useThisCommand")} side="top" delay={180}>
                  <button
                    type="button"
                    className={s.usedCommand}
                    data-testid="used-command"
                    aria-expanded={hasOptions && coarsePointer() ? detailsOpen : undefined}
                    onClick={() => {
                      // a touch screen has no hover: a tap shows what was filled in, as on Android
                      if (hasOptions && coarsePointer()) setDetailsOpen((o) => !o);
                      else useAppCommands.getState().startCommand({ channelId: msg.channel_id, applicationId: appId, name: it.name! });
                    }}
                  >
                    {command}
                  </button>
                </Tooltip>
              ) : hasOptions ? (
                <Tooltip text={invocation} side="top" delay={180}>
                  <span className={s.usedCommand} data-static="" tabIndex={0}>{command}</span>
                </Tooltip>
              ) : (
                <span className={s.usedCommand} data-static="">{command}</span>
              ),
          }}
        />
      </span>
      {detailsOpen ? <span className={s.usedDetails} data-testid="used-command-details" dir="ltr">{invocation}</span> : null}
    </div>
  );
}

/** An answer the app is still thinking about: it said it would answer, and has not yet. */
export function Thinking({ msg }: { msg: DecryptedMessage }) {
  const app = useUsers((u) => displayName(u.byId[msg.author_id], t("apps.anApp")));
  return (
    <span className={s.thinking} role="status" data-testid="app-thinking">
      <span className={s.dots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {t("apps.thinking", { app })}
    </span>
  );
}

/** Under an answer only this person sees: that only they see it, and the way to put it away. */
export function OnlyYou({ msg }: { msg: DecryptedMessage }) {
  return (
    <div className={s.onlyYou} data-testid="only-you">
      <Eye size={14} aria-hidden="true" />
      <span>{t("apps.onlyYou")}</span>
      <button type="button" className={s.dismiss} onClick={() => dismiss(msg)} data-testid="dismiss-ephemeral">
        {t("apps.dismissMessage")}
      </button>
    </div>
  );
}

function Glyph({ e, size = 18 }: { e: HookEmoji; size?: number }) {
  if (e.id) return <img className={s.glyph} src={emojiUrl(e.id, !!e.animated, size)} alt={e.name ? `:${e.name}:` : ""} width={size} height={size} loading="lazy" draggable={false} />;
  return e.name ? <Twemoji text={e.name} className={s.glyph} /> : null;
}

const VARIANT: Record<number, "primary" | "secondary" | "positive" | "danger"> = {
  [BUTTON_PRIMARY]: "primary",
  [BUTTON_SUCCESS]: "positive",
  [BUTTON_DANGER]: "danger",
};

/** A button on an app's message, which the app answers when pressed. */
export function AppButton({ b }: { b: HookComponent }) {
  const ctx = useContext(AppMsg);
  const [busy, setBusy] = useState(false);
  const usable = !!ctx?.interactive && !!b.custom_id && b.style !== BUTTON_PREMIUM && !b.disabled;
  const press = async () => {
    if (!ctx || !usable || busy) return;
    const { msg } = ctx;
    setBusy(true);
    await interact({ type: 3, application_id: msg.hook!.application_id!, channel_id: msg.channel_id, message_id: msg.id, data: { custom_id: b.custom_id, component_type: 2 } });
    setBusy(false);
  };
  return (
    <Button size="sm" variant={VARIANT[b.style ?? 0] ?? "secondary"} className={s.button} disabled={!usable} loading={busy} onClick={() => void press()} data-testid="app-button">
      {b.emoji ? <Glyph e={b.emoji} /> : null}
      {b.label ? <span className={s.buttonLabel} dir="auto">{b.label}</span> : null}
    </Button>
  );
}

/**
 * A select menu on an app's message. Picking sends what was picked to the
 * app: at once for a menu that takes one, when the list is closed for one
 * that takes several (if what is picked is within what it asks for).
 */
export function AppSelect({ c: comp }: { c: HookComponent }) {
  const ctx = useContext(AppMsg);
  const channelId = ctx?.msg.channel_id ?? "";
  const initial = useMemo(() => (comp.type === C_STRING_SELECT ? comp.options.filter((o) => o.default).map((o) => o.value) : comp.default_values.map((d) => d.id)), [comp]);
  const [picked, setPicked] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);
  useEffect(() => setPicked(initial), [initial]);
  const kind = entityKindOfComponent(comp.type);
  const min = comp.min_values ?? 1;
  const max = Math.max(min, comp.max_values ?? 1);
  const usable = !!ctx?.interactive && !!comp.custom_id && !comp.disabled;
  const search = useCallback(
    (q: string) => {
      if (kind) void findMembers(channelId, q).then(() => rerender((n) => n + 1));
    },
    [kind, channelId],
  );
  const send = async (values: string[]) => {
    if (!ctx) return;
    setPicked(values);
    setBusy(true);
    await interact({ type: 3, application_id: ctx.msg.hook!.application_id!, channel_id: ctx.msg.channel_id, message_id: ctx.msg.id, data: { custom_id: comp.custom_id, component_type: comp.type, values } });
    setBusy(false);
  };
  const options = comp.options;
  return (
    <SelectBox
      placeholder={comp.placeholder || t("apps.select.placeholder")}
      picked={picked}
      labelOf={(v) => (kind ? entityLabel(channelId, v) : (options.find((o) => o.value === v)?.label ?? v))}
      choicesFor={(q) =>
        kind
          ? entityChoices(kind, channelId, q, comp.channel_types)
          : options
              .filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()))
              .map((o) => ({ value: o.value, label: o.label, ...(o.description ? { description: o.description } : {}), ...(o.emoji ? { emoji: o.emoji } : {}) }))
      }
      min={min}
      max={max}
      disabled={!usable}
      busy={busy}
      searchable={!!kind || options.length > 8}
      onSearch={search}
      onCommit={(v) => void send(v)}
      testId="app-select"
    />
  );
}
