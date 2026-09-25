import { Folder } from "lucide-react";
import { iconUrl } from "@/api/users";
import { initials } from "@/lib/avatarColor";
import { useServers } from "@/stores/servers";
import s from "./Rail.module.css";

/**
 * What a folder's tile shows. Closed, the first four of its servers, small and
 * two by two, on the folder's colour; open, a folder in that colour, with the
 * servers themselves under it. The colour comes from `--folder` on an
 * ancestor.
 */
export function FolderFace({ serverIds, open }: { serverIds: string[]; open: boolean }) {
  const servers = useServers((st) => st.byId);
  if (open) return <Folder size={24} className={s.folderIcon} aria-hidden="true" />;
  return (
    <span className={s.grid} aria-hidden="true">
      {serverIds.slice(0, 4).map((id) => {
        const server = servers[id]?.server;
        const url = iconUrl(server?.icon_id ?? null, 32);
        return (
          <span key={id} className={s.mini}>
            {url ? <img src={url} alt="" draggable={false} /> : initials(server?.name ?? "")}
          </span>
        );
      })}
    </span>
  );
}
