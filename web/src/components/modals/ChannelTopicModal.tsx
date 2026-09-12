import { Hash } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { useChannels } from "@/stores/channels";

/** The full channel topic, rendered with markdown. */
export function ChannelTopicModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const channel = useChannels((c) => c.byId[channelId]);
  const ctx = useRenderCtx();
  if (!channel) return null;
  return (
    <Modal open onClose={onClose} title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Hash size={20} />{channel.name}</span>} width={480} footer={<Button onClick={onClose}>Close</Button>}>
      <div style={{ fontSize: 16, lineHeight: 1.4, color: "var(--text)", wordBreak: "break-word" }}>
        <Markdown source={channel.topic} ctx={ctx} />
      </div>
    </Modal>
  );
}
