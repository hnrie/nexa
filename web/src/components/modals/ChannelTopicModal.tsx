import { Button } from "@/components/common/Button";
import { ChannelGlyph } from "@/components/common/ChannelGlyph";
import { Modal } from "@/components/common/Modal";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { useChannels } from "@/stores/channels";

import { t } from "@/i18n";
/** The full channel topic, rendered with markdown. */
export function ChannelTopicModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const channel = useChannels((c) => c.byId[channelId]);
  const ctx = useRenderCtx();
  if (!channel) return null;
  return (
    <Modal open onClose={onClose} title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ChannelGlyph channel={channel} size={20} />{channel.name}</span>} width={480} footer={<Button onClick={onClose}>{t("chat.attachments.close")}</Button>}>
      <div style={{ fontSize: 16, lineHeight: 1.4, color: "var(--text)", wordBreak: "break-word" }}>
        <Markdown source={channel.topic} ctx={ctx} />
      </div>
    </Modal>
  );
}
