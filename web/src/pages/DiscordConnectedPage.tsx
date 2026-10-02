import { Check, Clock, TriangleAlert, Unplug, UserRoundX } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AuthLayout, usePageTitle } from "./AuthLayout";
import s from "./Auth.module.css";

import { t } from "@/i18n";

type Result = "linked" | "denied" | "expired" | "taken" | "failed";

/**
 * Where the system's browser ends up after linking Discord from the desktop
 * app. The app is where the person is signed in; this browser may be signed in
 * to nobody, or to somebody else, so the page only says how it went and sends
 * them back. The app hears of the link from the server.
 */
export default function DiscordConnectedPage() {
  const [params] = useSearchParams();
  const asked = params.get("result");
  const result: Result = asked === "linked" || asked === "denied" || asked === "expired" || asked === "taken" ? asked : "failed";
  const said = {
    linked: { title: t("connected.discord.linkedTitle"), body: t("connected.discord.linkedBody"), icon: <Check size={30} strokeWidth={2.4} /> },
    denied: { title: t("connected.discord.deniedTitle"), body: t("connected.discord.deniedBody"), icon: <Unplug size={28} /> },
    expired: { title: t("connected.discord.expiredTitle"), body: t("connected.discord.expiredBody"), icon: <Clock size={28} /> },
    taken: { title: t("connected.discord.takenTitle"), body: t("connected.discord.takenBody"), icon: <UserRoundX size={28} /> },
    failed: { title: t("connected.discord.failedTitle"), body: t("connected.discord.failedBody"), icon: <TriangleAlert size={28} /> },
  }[result];
  usePageTitle(said.title);
  return (
    <AuthLayout
      title={said.title}
      subtitle={said.body}
      width={440}
      mark={<div className={s.mark} data-tone={result === "linked" ? "good" : "warn"} data-testid="discord-connected" data-result={result} aria-hidden="true">{said.icon}</div>}
    />
  );
}
