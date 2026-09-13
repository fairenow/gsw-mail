import type { MessageSummary } from "../api";
import { fmtTime } from "./folders";

const sx: { [k: string]: React.CSSProperties } = {
  row: { padding: "10px 14px", borderBottom: "1px solid #f2f2f2", cursor: "pointer" },
  rowRead: { opacity: 0.7 },
};

export function MessageRow({
  message,
  onOpen,
}: {
  message: MessageSummary;
  onOpen: () => void;
}) {
  return (
    <article
      onClick={onOpen}
      style={{ ...sx.row, ...(message.read ? sx.rowRead : {}) }}
    >
      <strong>{message.from?.name ?? message.from?.email ?? "(unknown sender)"}</strong>
      <div>{message.subject || "(no subject)"}</div>
      <small>{message.snippet}</small>
      <time>{fmtTime(message.date)}</time>
    </article>
  );
}
