import type { MessageSummary } from "../api";
import { fmtTime } from "./folders";

export function MessageRow({
  message,
  active,
  onOpen,
}: {
  message: MessageSummary;
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <article
      onClick={onOpen}
      style={{ ...sx.row, ...(active ? sx.rowActive : {}), ...(message.read ? sx.rowRead : {}) }}
    >
      <strong>{message.from?.name ?? message.from?.email ?? "(unknown sender)"}</strong>
      <div>{message.subject || "(no subject)"}</div>
      <small>{message.snippet}</small>
      <time>{fmtTime(message.date)}</time>
    </article>
  );
}

const sx: Record<string, React.CSSProperties> = {
  row: { padding: "10px 14px", borderBottom: "1px solid #f3f3f3", cursor: "pointer" },
  rowActive: { background: "#f0f6ff" },
  rowRead: { opacity: 0.7 },
};
