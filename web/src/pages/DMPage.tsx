import { useParams } from "react-router-dom";

export default function DMPage() {
  const { channelId } = useParams();
  return <div style={{ padding: 24, color: "var(--text-muted)" }}>DM {channelId}</div>;
}
