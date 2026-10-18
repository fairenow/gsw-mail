import { useEffect, useState } from "react";
import { api, type McpApprovalRecord, type McpDraftPreview } from "../api";

/** GSW first-party review surface; no draft is executed by these controls. */
export function McpDraftApprovals() {
  const [approvals, setApprovals] = useState<McpApprovalRecord[]>([]);
  const [selected, setSelected] = useState<McpDraftPreview | null>(null);
  const [reviewedDigest, setReviewedDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      const result = await api.mcpApprovals();
      setApprovals(result.approvals);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pending actions");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const review = async (approval: McpApprovalRecord) => {
    setBusy(approval.id);
    setSelected(null);
    setReviewedDigest(null);
    setNotice("");
    try {
      const result = await api.mcpDraftPreview(approval.id);
      setSelected(result.draft);
      setReviewedDigest(result.reviewedArgumentsDigest);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load draft preview");
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (!selected || !reviewedDigest) return;
    const id = selected.approvalId;
    setBusy(id);
    setError("");
    try {
      await api.decideMcpApproval(id, decision, reviewedDigest);
      setSelected(null);
      setReviewedDigest(null);
      setNotice(decision === "approved"
        ? "Draft proposal approved. Execution is not enabled yet; no draft was created."
        : "Draft proposal rejected. No draft was created.");
      await reload();
    } catch (cause) {
      setSelected(null);
      setReviewedDigest(null);
      setError(cause instanceof Error ? `${cause.message}. Refresh and review the proposal again.` : "Could not record approval decision. Refresh and review again.");
    } finally {
      setBusy(null);
    }
  };

  const pending = approvals.filter(a => a.status === "pending" && Date.parse(a.expiresAt) > clock);
  return <div className="gsw-settings-card">
    <div className="gsw-settings-card-head">
      <div>
        <h2>AI app approvals</h2>
        <p>Review exact draft contents before approving a request from a connected app. Approving currently records your decision only; it does not create or send an email.</p>
      </div>
      <button type="button" className="gsw-secondary-btn" disabled={loading} onClick={() => void reload()}>Refresh</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p>Loading approvals…</p> : pending.length === 0 ? <p>No pending draft approvals.</p> :
      <ul style={{ maxHeight: 280, overflowY: "auto", paddingRight: 12 }}>{pending.map(a => <li key={a.id}>
        <strong>{a.summary}</strong> — {a.toolName}
        <span> · Expires {new Date(a.expiresAt).toLocaleString()}</span>{" "}
        <button type="button" className="gsw-secondary-btn" disabled={busy !== null} onClick={() => void review(a)}>
          {busy === a.id ? "Loading…" : "Review"}
        </button>
      </li>)}</ul>}
    {selected && <section className="gsw-settings-card" aria-label="Proposed email draft" style={{ overflowWrap: "anywhere" }}>
      <h3>Review proposed email draft</h3>
      <div role="region" aria-label="Draft content to review" tabIndex={0} style={{ maxHeight: "min(45vh, 420px)", overflowY: "auto", overscrollBehavior: "contain", paddingRight: 12 }}>
      <p><strong>Mailbox:</strong> {selected.accountId}</p>
      <p><strong>To:</strong> {selected.arguments.to.join(", ")}</p>
      {selected.arguments.cc?.length ? <p><strong>CC:</strong> {selected.arguments.cc.join(", ")}</p> : null}
      {selected.arguments.bcc?.length ? <p><strong>BCC:</strong> {selected.arguments.bcc.join(", ")}</p> : null}
      <p><strong>Subject:</strong> {selected.arguments.subject || "(no subject)"}</p>
      {selected.arguments.replyTo && <p><strong>Reply to:</strong> {selected.arguments.replyTo}</p>}
      {selected.arguments.textBody !== undefined && <>
        <h4>Plain-text body</h4>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.arguments.textBody}</pre>
      </>}
      {selected.arguments.htmlBody !== undefined && <>
        <h4>HTML body (source, not executed)</h4>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.arguments.htmlBody}</pre>
      </>}
      </div>
      <p>Expires {new Date(selected.expiresAt).toLocaleString()}. No draft will be created by this approval.</p>
      {Date.parse(selected.expiresAt) <= clock && <p role="alert">This request has expired. Refresh to review current requests.</p>}
      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" className="gsw-primary-btn" disabled={busy !== null || !reviewedDigest || Date.parse(selected.expiresAt) <= clock} onClick={() => void decide("approved")}>Approve proposal</button>
        <button type="button" className="gsw-secondary-btn" disabled={busy !== null || Date.parse(selected.expiresAt) <= clock} onClick={() => void decide("rejected")}>Reject</button>
        <button type="button" className="gsw-secondary-btn" disabled={busy !== null} onClick={() => { setSelected(null); setReviewedDigest(null); }}>Close</button>
      </div>
    </section>}
  </div>;
}
