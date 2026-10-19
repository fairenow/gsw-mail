import { useState } from "react";
import { establishMcpMailboxCredentials } from "../auth";

/** First-party repair, independent of the ChatGPT connection lifecycle.
 * Server endpoint requires a trusted-origin signed-in GSW session. */
export function McpMailboxRecoveryPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recover = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await establishMcpMailboxCredentials();
      if (result.attempted === 0) setMessage("No readable mailbox was found. Sign in to GSW Mail and confirm mailbox setup first.");
      else if (result.failures.length) setMessage(`Recovery failed for ${result.failures.length} of ${result.attempted} mailboxes (${result.failures[0]!.reason}). Sign in again or contact support.`);
      else setMessage(`Mailbox access restored for ${result.established} mailbox(es). Return to ChatGPT and retry your request.`);
    } catch {
      setMessage("Could not verify your signed-in GSW Mail session. Please sign in and retry.");
    } finally { setBusy(false); }
  };
  return <main style={{maxWidth: 560, margin: "4rem auto", padding: "1.5rem"}}>
    <h1>Restore ChatGPT mailbox access</h1>
    <p>While signed in to GSW Mail, restore your own mailbox authorization. This does not send email or change your ChatGPT permissions.</p>
    <button type="button" disabled={busy} onClick={() => void recover()}>{busy ? "Checking mailbox access…" : "Restore mailbox access"}</button>
    {message && <p role="status">{message}</p>}
    <p><a href="/settings">Return to settings</a></p>
  </main>;
}
