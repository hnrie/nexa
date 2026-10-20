import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { copyAndSay } from "@/lib/copyText";
import { describeError } from "@/lib/errors";
import { authKeyFor } from "@/lib/passwordProof";
import { HighlightedCode } from "@/markdown/render";
import s from "./Portal.module.css";

/** A small button that copies something and says so. */
export function CopyButton({ value, label, done }: { value: string; label: string; done?: string }) {
  return (
    <button type="button" className={s.copyBtn} aria-label={label} title={label} onClick={() => copyAndSay(value, done ?? t("apps.portal.copied"))}>
      <Copy size={15} aria-hidden="true" />
    </button>
  );
}

/** An id or a key someone copies into their code: its name, the value, and Copy. */
export function IdChip({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <span className={s.idChip} data-testid={testId}>
      <span>{label}</span>
      <code>{value}</code>
      <CopyButton value={value} label={t("apps.portal.copyNamed", { name: label })} />
    </span>
  );
}

/**
 * A secret shown this once (a bot's token, an app's client secret): set into
 * the page with Copy, and what it is for. It is not kept anywhere to show
 * again: lose it, and it can only be reset.
 */
export function SecretReveal({ value, note, onDone, testId }: { value: string; note: string; onDone: () => void; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.secret} data-testid={testId}>
      <div className={s.secretValue}>{value}</div>
      <div className={s.secretNote}>{note}</div>
      <div className={s.secretActions}>
        <Button
          size="sm"
          onClick={() => {
            copyAndSay(value, t("apps.portal.copied"));
            setCopied(true);
          }}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? t("apps.portal.copiedShort") : t("apps.portal.copy")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>{t("apps.portal.done")}</Button>
      </div>
    </div>
  );
}

/**
 * Asks for the account's password before something that cannot be taken
 * back: a new token or secret (the old one stops working), deleting an app.
 * The password never leaves the device; what is sent is proof of it.
 */
export function PasswordConfirm({ title, body, confirm, danger = false, run, onClose }: { title: string; body: string; confirm: string; danger?: boolean; run: (authKey: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await run(await authKeyFor(password));
      onClose();
    } catch (err) {
      setError(describeError(err, t("apps.portal.failed")));
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      onSubmit={() => void go()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("apps.cancel")}</Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} disabled={!password} onClick={() => void go()} data-testid="password-confirm">{confirm}</Button>
        </>
      }
    >
      <p style={{ margin: "0 0 16px", fontSize: 15, lineHeight: "21px", color: "var(--text-subtle)" }}>{body}</p>
      <Field label={t("apps.portal.password")} error={error}>
        <TextInput type="password" reveal autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password-input" />
      </Field>
    </Modal>
  );
}

type Lib = "py" | "js" | "go" | "other";

/** The lines that point each bot library at this server. */
function snippet(lib: Lib, base: string): string {
  const ws = base.replace(/^http/, "ws");
  switch (lib) {
    case "py":
      return [
        "import discord",
        "import yarl",
        "",
        `BASE = "${base}"`,
        'discord.http.Route.BASE = BASE + "/api/v10"',
        `discord.gateway.DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("${ws}/bot-gateway/")`,
        'discord.Asset.BASE = BASE + "/cdn"',
      ].join("\n");
    case "js":
      return [
        'const { Client, GatewayIntentBits } = require("discord.js");',
        "",
        "const client = new Client({",
        "  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],",
        `  rest: { api: "${base}/api", cdn: "${base}/cdn" },`,
        "});",
      ].join("\n");
    case "go":
      return [
        `const base = "${base}"`,
        "",
        "func pointAtNexa() {",
        '\tapi := base + "/api/v" + discordgo.APIVersion + "/"',
        '\tdiscordgo.EndpointDiscord = base + "/"',
        "\tdiscordgo.EndpointAPI = api",
        '\tdiscordgo.EndpointGuilds = api + "guilds/"',
        '\tdiscordgo.EndpointChannels = api + "channels/"',
        '\tdiscordgo.EndpointUsers = api + "users/"',
        '\tdiscordgo.EndpointGateway = api + "gateway"',
        '\tdiscordgo.EndpointGatewayBot = discordgo.EndpointGateway + "/bot"',
        '\tdiscordgo.EndpointWebhooks = api + "webhooks/"',
        '\tdiscordgo.EndpointStickers = api + "stickers/"',
        '\tdiscordgo.EndpointApplications = api + "applications"',
        '\tdiscordgo.EndpointOAuth2 = api + "oauth2/"',
        '\tdiscordgo.EndpointOAuth2Applications = discordgo.EndpointOAuth2 + "applications"',
        '\tcdn := base + "/cdn/"',
        "\tdiscordgo.EndpointCDN = cdn",
        '\tdiscordgo.EndpointCDNAttachments = cdn + "attachments/"',
        '\tdiscordgo.EndpointCDNAvatars = cdn + "avatars/"',
        '\tdiscordgo.EndpointCDNIcons = cdn + "icons/"',
        '\tdiscordgo.EndpointCDNBanners = cdn + "banners/"',
        '\tdiscordgo.EndpointCDNGuilds = cdn + "guilds/"',
        '\tdiscordgo.EndpointCDNRoleIcons = cdn + "role-icons/"',
        "}",
      ].join("\n");
    default:
      return [`API      ${base}/api/v10`, `Gateway  ${ws}/bot-gateway`, `CDN      ${base}/cdn`, `OAuth2   ${base}/oauth2/authorize`].join("\n");
  }
}

/**
 * How to point a bot library at this server: the few lines that change, for
 * the libraries people use most, and the addresses for any other.
 */
/** The language each library's lines are written in, for their colours. */
const LIB_LANG: Record<Lib, string | null> = { py: "python", js: "javascript", go: "go", other: null };

export function LibrarySnippets({ base }: { base: string }) {
  const [lib, setLib] = useState<Lib>("py");
  const tabs: { id: Lib; label: string }[] = [
    { id: "py", label: "discord.py" },
    { id: "js", label: "discord.js" },
    { id: "go", label: "discordgo" },
    { id: "other", label: t("apps.portal.otherLibraries") },
  ];
  const code = snippet(lib, base);
  return (
    <div className={s.libs}>
      <div className={s.libTabs} role="tablist" aria-label={t("apps.portal.libraries")}>
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={lib === x.id} className={s.libTab} onClick={() => setLib(x.id)} data-testid={`lib-${x.id}`}>
            {x.label}
          </button>
        ))}
      </div>
      <pre className={s.code} dir="ltr">
        <code className="hljs">
          <HighlightedCode lang={LIB_LANG[lib]} text={code} />
        </code>
        <CopyButton value={code} label={t("apps.portal.copyCode")} />
      </pre>
      <p className={s.libNote}>{lib === "other" ? t("apps.portal.otherNote") : lib === "js" ? t("apps.portal.jsNote") : t("apps.portal.libNote")}</p>
    </div>
  );
}
