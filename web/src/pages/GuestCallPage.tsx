import { PhoneCall, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import { GUEST_FLAG, type Channel, type GuestInfo, type MeUser } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { ShareScreenModal } from "@/components/voice/ShareScreenModal";
import { VoiceView } from "@/components/voice/VoiceView";
import type { GatewayEvent } from "@/gateway/events";
import { startGuestSession, stopGuestSession } from "@/gateway/session";
import { guarded } from "@/lib/captcha";
import { parseInviteFragment } from "@/lib/inviteLink";
import { storage } from "@/lib/storage";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { clearGuestKeys, setGuestKey } from "@/voice/guestKeys";
import { audioContext } from "@/voice/media";
import { handleVoiceEvent, installVoice, joinVoice, leaveVoice, onReadyVoice } from "@/voice/session";
import s from "./GuestCallPage.module.css";

import { t } from "@/i18n";
type Phase = "checking" | "invalid" | "form" | "joining" | "call" | "ended";

/** Why a guest's time in the call ended, as the server says it; and whether the link may take them again. */
const ENDINGS: Record<string, { text: string; again: boolean }> = {
  left: { text: "You left the call.", again: true },
  removed: { text: "You were removed from the call.", again: false },
  revoked: { text: "The link you joined with was turned off.", again: false },
  expired: { text: "Your time as a guest is up.", again: true },
  unavailable: { text: "This call no longer takes guests.", again: false },
  ended: { text: "This call is gone.", again: false },
  gone: { text: "You were away from the call for too long.", again: true },
};

/** Where this tab keeps its guest session, so a reload goes straight back in. Never localStorage: it would outlive the tab. */
const storeName = (code: string) => `ec.guest.${code}`;

function savedSession(code: string): { token: string; guest: GuestInfo } | null {
  try {
    const raw = sessionStorage.getItem(storeName(code));
    return raw ? (JSON.parse(raw) as { token: string; guest: GuestInfo }) : null;
  } catch {
    return null;
  }
}

function saveSession(code: string, value: { token: string; guest: GuestInfo } | null): void {
  try {
    if (value) sessionStorage.setItem(storeName(code), JSON.stringify(value));
    else sessionStorage.removeItem(storeName(code));
  } catch {
    /* private mode: a reload asks for a name again */
  }
}

/** The one channel a guest knows: the call, with nothing else about it. */
function callChannel(id: string): Channel {
  return { id, server_id: null, type: "voice", name: "Voice call", topic: "", position: 0, parent_id: null, nsfw: false, slowmode_seconds: 0, user_limit: 0, owner_id: null, icon_id: null, last_message_id: null, created_at: 0, recipient_ids: [], key_conv_id: id };
}

function guestMe(g: GuestInfo): MeUser {
  return {
    id: g.id, username: "", display_name: g.display_name, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null,
    status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: GUEST_FLAG, created_at: 0, presence_pref: "online", dm_privacy: "nobody", has_recovery: false,
  } as MeUser;
}

/**
 * Where a guest link lands: a name and a captcha, then the call and nothing
 * else. It runs outside the app: no account, keys or conversations are loaded,
 * and the call's key comes from the link's fragment.
 */
export default function GuestCallPage() {
  const { code = "" } = useParams();
  const loc = useLocation();
  const key = useMemo(() => parseInviteFragment(loc.hash), [loc.hash]);
  const [phase, setPhase] = useState<Phase>("checking");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<{ text: string; again: boolean } | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const modals = useUI((u) => u.modals);
  const closeModal = useUI((u) => u.closeModal);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // someone with an account on this browser (who opened a link from a chat, say) has a way back to the app
  const [signedIn] = useState(() => !!storage.get("ec.token"));

  const endStay = (reason: string) => {
    saveSession(code, null);
    void leaveVoice(false);
    stopGuestSession();
    api.setToken(null);
    clearGuestKeys();
    setEnding(ENDINGS[reason] ?? { text: "Your time in the call is over.", again: false });
    setPhase("ended");
  };

  const begin = (token: string, guest: GuestInfo, join: boolean) => {
    api.setToken(token);
    if (key) setGuestKey(guest.channel_id, key.epoch, key.root);
    const ch = callChannel(guest.channel_id);
    useAuth.setState({ me: guestMe(guest) });
    useChannels.setState({ byId: { [ch.id]: ch } });
    setChannel(ch);
    let ready = false;
    startGuestSession(token, (e: GatewayEvent) => {
      switch (e.t) {
        case "ready":
          onReadyVoice(e.d.voice_states ?? [], e.d.session_id);
          if (!ready) {
            ready = true;
            setPhase("call");
            if (join) void joinVoice(guest.channel_id);
          }
          return;
        case "voice_state":
        case "voice_signal":
        case "voice_error":
        case "voice_resumed":
        case "call_ring":
        case "call_end":
          handleVoiceEvent(e);
          return;
        case "guest_ended":
          endStay(e.d.reason);
          return;
        case "session_expired":
          if (phaseRef.current === "ended") return;
          if (ready) {
            endStay("expired");
            return;
          }
          // a stay this tab remembered is over: ask for a name again
          saveSession(code, null);
          stopGuestSession();
          api.setToken(null);
          setPhase("form");
          return;
        default:
          return;
      }
    });
  };

  useEffect(() => {
    // Reached from inside the app, the tab still runs someone's account, which a guest must not
    // share a page with: start over as a fresh page.
    if (useAuth.getState().status !== "idle") {
      window.location.reload();
      return;
    }
    installVoice();
    document.title = "Voice call";
    if (!key) {
      setError("This link is missing its key. Ask for the whole link, including the part after #.");
      setPhase("invalid");
      return;
    }
    const prior = savedSession(code);
    if (prior) {
      setName(prior.guest.display_name);
      setPhase("joining");
      begin(prior.token, prior.guest, true);
    } else {
      guestsApi
        .check(code)
        .then(() => setPhase((p) => (p === "checking" ? "form" : p)))
        .catch((err) => {
          setError(err instanceof ApiError && err.status === 404 ? "This link is invalid or has expired." : "Could not check the link. Try again in a moment.");
          setPhase("invalid");
        });
    }
    return () => {
      void leaveVoice(true);
      stopGuestSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const join = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || phase === "joining") return;
    // made inside the tap: iOS only lets a call's audio start in a gesture
    audioContext();
    setError(null);
    setPhase("joining");
    try {
      const res = await guarded("guest_join", (captcha) => guestsApi.join(code, trimmed, captcha));
      saveSession(code, res);
      begin(res.token, res.guest, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the call.");
      setPhase(err instanceof ApiError && err.code === "invalid_guest_link" ? "invalid" : "form");
    }
  };

  const leave = async () => {
    await guestsApi.leave().catch(() => undefined);
    endStay("left");
  };

  if (phase === "call" && channel) {
    const top = modals[modals.length - 1];
    return (
      <div className={s.call} data-testid="guest-call">
        <header className={s.bar}>
          <PhoneCall size={18} className={s.barIcon} />
          <span className={s.barTitle}>{t("guestCall.voiceCall")}</span>
          <span className={s.barWho}>
            <span className={s.tag}>{t("voice.voiceParticipants.guest")}</span>
            <span className={s.barName}>{name}</span>
          </span>
          <Button size="sm" variant="danger" onClick={() => void leave()} data-testid="guest-leave">{t("guestCall.leave")}</Button>
        </header>
        <div className={s.stage}>
          <VoiceView channel={channel} guest />
        </div>
        {top?.kind === "shareScreen" ? <ShareScreenModal onClose={() => closeModal(top.id)} /> : null}
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.card} data-testid="guest-landing">
        <div className={s.icon} data-state={phase === "invalid" || (phase === "ended" && !ending?.again) ? "off" : undefined}>
          <PhoneCall size={32} />
        </div>
        {phase === "checking" || phase === "joining" ? (
          <>
            <h1 className={s.title}>{phase === "joining" ? "Joining the call…" : "Checking the link…"}</h1>
            <Spinner size={28} />
          </>
        ) : phase === "invalid" ? (
          <>
            <h1 className={s.title}>{t("guestCall.canTJoinThisCall")}</h1>
            <p className={s.sub}>{error}</p>
          </>
        ) : phase === "ended" ? (
          <>
            <h1 className={s.title}>{ending?.text ?? "The call is over."}</h1>
            {ending?.again ? (
              <Button onClick={() => { setEnding(null); setPhase("checking"); void guestsApi.check(code).then(() => setPhase("form"), () => { setError("This link is invalid or has expired."); setPhase("invalid"); }); }} data-testid="guest-again">
                Join Again
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <h1 className={s.title}>{t("guestCall.youReInvitedToAVoice")}</h1>
            <p className={s.sub}>{t("guestCall.noAccountNeededPickTheName")}</p>
            <form className={s.form} onSubmit={(e) => void join(e)}>
              <Field label={t("guestCall.yourName")}>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={32} autoFocus autoComplete="nickname" placeholder={t("guestCall.whatShouldWeCallYou")} data-testid="guest-name" />
              </Field>
              {error ? <p className={s.error}>{error}</p> : null}
              <Button type="submit" block disabled={!name.trim()} data-testid="guest-join">{t("guestCall.joinCall")}</Button>
            </form>
            <p className={s.fine}>
              <ShieldCheck size={14} /> As a guest you can only be in this call. The call stays end-to-end encrypted.
            </p>
          </>
        )}
        {signedIn && phase !== "checking" && phase !== "joining" ? <a className={s.back} href="/channels/@me">{t("guestCall.backToNexa")}</a> : null}
      </div>
    </div>
  );
}
