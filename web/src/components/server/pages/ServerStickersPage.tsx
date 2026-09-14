import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import { P } from "@/lib/perms";
import { useExpressions } from "@/stores/expressions";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import { PackEditor } from "../PackEditor";
import { promptText } from "@/components/modals/PromptModal";

/** Server settings → Stickers: packs owned by this server, managed with Manage Expressions. */
export default function ServerStickersPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const packs = useExpressions((x) => x.packs);
  const upsertPack = useExpressions((x) => x.upsertPack);
  const toast = useUI((u) => u.toast);
  const [selected, setSelected] = useState<string | null>(null);
  const manage = canI(server, P.MANAGE_EMOJIS);
  const list = useMemo(() => Object.values(packs).filter((p) => p.server_id === serverId).sort((a, b) => b.updated_at - a.updated_at), [packs, serverId]);

  const create = async () => {
    const name = await promptText("Create Server Pack", { label: "Pack name", initial: `${server?.server.name ?? "Server"} stickers`, maxLength: 60 }, "Create");
    if (!name?.trim()) return;
    try {
      const pack = await expressionsApi.createPack({ name: name.trim(), server_id: serverId });
      upsertPack(pack);
      setSelected(pack.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create the pack.", "error");
    }
  };

  return (
    <>
      <h2 className={st.title}>Stickers</h2>
      <p className={st.hint}>Sticker packs that belong to this server. Every member can use them here; make a pack public to let anyone install it. There is no limit on packs or stickers.</p>
      <PackEditor packs={list} selectedId={selected} onSelect={setSelected} canManage={() => manage} onCreate={manage ? () => void create() : undefined} createLabel="Create Server Pack" emptyText={manage ? "This server has no sticker packs yet." : "This server has no sticker packs yet. Members with Manage Expressions can add some."} />
    </>
  );
}
