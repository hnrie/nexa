import { X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { ServerCard } from "@/components/discovery/DiscoveryPage";
import { t } from "@/i18n";
import { LANGUAGES } from "@/i18n/core";
import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import { SaveBar } from "../SettingsLayer";
import s from "../ServerSettings.module.css";

const CATEGORIES = ["gaming", "music", "entertainment", "creative", "science_tech", "education", "anime", "sports", "community", "other"];
const MAX_TAGS = 5;

/**
 * How a server shows on Discovery: whether it is listed at all, its
 * category, the tags people find it by, and its language. What it says
 * about itself is the description on Overview.
 */
export default function DiscoverySettingsPage({ serverId }: { serverId: string }) {
  const st_ = useServers((x) => x.byId[serverId]);
  const server = st_?.server;
  const toast = useUI((u) => u.toast);
  const presence = usePresence((p) => p.byUser);
  const meId = useAuth((a) => a.me?.id);
  const [listed, setListed] = useState<boolean | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!server || !st_) return null;
  const isListed = listed ?? !!server.discoverable;
  const cat = category ?? server.discovery_category ?? "";
  const tagList = tags ?? server.discovery_tags ?? [];
  const lang = language ?? server.discovery_language ?? "";
  const dirty = isListed !== !!server.discoverable || cat !== (server.discovery_category ?? "") || tagList.join("|") !== (server.discovery_tags ?? []).join("|") || lang !== (server.discovery_language ?? "");
  const reset = () => {
    setListed(null);
    setCategory(null);
    setTags(null);
    setLanguage(null);
  };
  const addTag = () => {
    const tag = tagText.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || tagList.includes(tag) || tagList.length >= MAX_TAGS) return;
    setTags([...tagList, tag.slice(0, 20)]);
    setTagText("");
  };
  const save = async () => {
    setBusy(true);
    try {
      const srv = await serversApi.patch(serverId, { discoverable: isListed, discovery_category: cat, discovery_tags: tagList, discovery_language: lang });
      useServers.getState().updateServer(srv);
      reset();
      toast(isListed ? t("discovery.settings.savedListed") : t("discovery.settings.saved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("discovery.settings.failed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const preview = {
    id: server.id,
    name: server.name,
    icon_id: server.icon_id,
    banner_id: server.banner_id,
    description: server.description,
    category: cat,
    tags: tagList,
    language: lang,
    member_count: st_.memberCount,
    // the members this app has loaded who are about now, which is everyone in a small server
    online_count: Object.keys(st_.members).filter((id) => {
      const status = presence[id]?.status ?? (id === meId ? "online" : undefined);
      return !!status && status !== "offline" && status !== "invisible";
    }).length,
    created_at: server.created_at,
    listed_at: null,
    tag: null,
    member: false,
    joins_paused: false,
  };
  return (
    <>
      <h2 className={st.title}>{t("discovery.title")}</h2>
      <p className={st.hint} style={{ marginTop: -12, marginBottom: 20 }}>{t("discovery.settings.intro")}</p>
      <div className={st.form}>
        <Toggle checked={isListed} onChange={setListed} label={t("discovery.settings.list")} description={t("discovery.settings.listDesc")} />
        {server.discovery_hidden ? <div className={s.warn}>{t("discovery.settings.hidden")}</div> : null}
        <Field label={t("discovery.settings.category")}>
          <Select value={cat} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("discovery.settings.noCategory")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`discovery.cat.${c}`)}</option>)}
          </Select>
        </Field>
        <Field as="div" label={t("discovery.settings.tags")} hint={t("discovery.settings.tagsHint", { count: MAX_TAGS })}>
          <div className={s.tagPick}>
            {tagList.map((tg) => (
              <span key={tg} className={s.tagChip} aria-pressed="true">
                {tg}
                <button type="button" className={s.tagRemove} aria-label={t("discovery.settings.removeTag", { tag: tg })} onClick={() => setTags(tagList.filter((x) => x !== tg))}><X size={13} /></button>
              </span>
            ))}
          </div>
          {tagList.length < MAX_TAGS ? (
            <TextInput
              value={tagText}
              onChange={(e) => setTagText(e.target.value.slice(0, 20))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder={t("discovery.settings.tagPlaceholder")}
              style={{ marginTop: 8 }}
              data-testid="discovery-tag-input"
            />
          ) : null}
        </Field>
        <Field label={t("discovery.settings.language")}>
          <Select value={lang} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{t("discovery.anyLanguage")}</option>
            {LANGUAGES.map((l) => <option key={l.tag} value={l.tag}>{l.endonym}</option>)}
          </Select>
        </Field>
        <Field as="div" label={t("discovery.settings.preview")} hint={server.description ? undefined : t("discovery.settings.noDescription")}>
          <div style={{ maxWidth: 340 }}>
            <ServerCard card={preview} onOpen={() => undefined} onTag={() => undefined} />
          </div>
        </Field>
      </div>
      <SaveBar dirty={dirty} busy={busy} onReset={reset} onSave={() => void save()} />
    </>
  );
}
