import type { FullMessage } from "../api";
import { fmtTime } from "./folders";

export function MessageReader({
  message,
  onArchive,
  onTrash,
}: {
  message: FullMessage;
  onArchive: () => void;
  onTrash: () => void;
}) {
  return (
    <article style={sx.reader}>
      <h2>{message.subject || "(no subject)"}</h2>
      <p style={sx.meta}>
        From {message.from?.name ?? ""} &lt;{message.from?.email}&gt; · {fmtTime(message.date)}
      </p>
      <div style={sx.actions}>
        <button onClick={onArchive}>Archive</button>
        <button onClick={onTrash}>Delete</button>
      </div>
      <pre style={sx.body}>{message.textBody ?? message.htmlBody?.replace(/<[^>]+>/g, "") ?? ""}</pre>
    </article>
  );
}

const sx: Record<string, React.CSSProperties> = {
  reader: { flex: 1, padding: 20, overflow: "auto" },
  meta: { color: "#555" },
  actions: { display: "flex", gap: 8, margin: "12px 0" },
  body: { whiteSpace: "pre-wrap", fontFamily: "inherit" },
};
