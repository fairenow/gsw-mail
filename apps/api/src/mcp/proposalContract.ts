/**
 * The submission contract is intentionally LLM-neutral.
 * An MCP client may propose arbitrary connections, bugs, or improvements
 * without gaining access to administrative actions.
 */
export type ProposalKind = "bug" | "connection" | "improvement" | "security" | "question";
export type ProposalPriority = "low" | "normal" | "high" | "critical";
export type ProposalStatus = "submitted" | "triaged" | "accepted" | "rejected" | "resolved";

export interface McpProposal {
  title: string;
  kind: ProposalKind;
  priority: ProposalPriority;
  summary: string;
  evidence?: string;
  suggestedAction?: string;
  relatedTool?: string;
  sourceClient: string;
  requesterUserId: string;
}

const kinds: readonly string[] = ["bug", "connection", "improvement", "security", "question"];
const priorities: readonly string[] = ["low", "normal", "high", "critical"];

export function validateMcpProposal(input: unknown): Omit<McpProposal, "requesterUserId" | "sourceClient"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_proposal");
  const v = input as Record<string, unknown>;
  const bounded = (key: string, max: number, required = false) => {
    const value = v[key];
    if (value === undefined || value === null) {
      if (required) throw new Error(`missing_${key}`);
      return undefined;
    }
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`invalid_${key}`);
    return value.trim();
  };
  const kind = bounded("kind", 32, true)!;
  const priority = bounded("priority", 32, true)!;
  if (!kinds.includes(kind) || !priorities.includes(priority)) throw new Error("invalid_proposal_type");
  return {
    kind: kind as ProposalKind,
    priority: priority as ProposalPriority,
    title: bounded("title", 180, true)!,
    summary: bounded("summary", 10000, true)!,
    evidence: bounded("evidence", 16000),
    suggestedAction: bounded("suggestedAction", 10000),
    relatedTool: bounded("relatedTool", 180),
  };
}

export const proposalToolSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: kinds },
    priority: { type: "string", enum: priorities },
    title: { type: "string", maxLength: 180 },
    summary: { type: "string", maxLength: 10000 },
    evidence: { type: "string", maxLength: 16000 },
    suggestedAction: { type: "string", maxLength: 10000 },
    relatedTool: { type: "string", maxLength: 180 },
  },
  required: ["kind", "priority", "title", "summary"],
  additionalProperties: false,
} as const;

export const PROPOSAL_NOTIFICATION_RECIPIENT = "ramon@team.guidedstepswellness.com";

/** Escape strings from external models before including them in email HTML. */
export const escapeProposalHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function renderProposalNotification(p: McpProposal): { subject: string; text: string; html: string } {
  const lines = [
    `New GSW MCP proposal: ${p.title}`,
    `Kind: ${p.kind}`,
    `Priority: ${p.priority}`,
    `Source: ${p.sourceClient}`,
    `Proposed by user ID: ${p.requesterUserId}`,
    `Summary: ${p.summary}`,
    p.evidence ? `Evidence: ${p.evidence}` : "",
    p.suggestedAction ? `Suggested action: ${p.suggestedAction}` : "",
    p.relatedTool ? `Related tool: ${p.relatedTool}` : "",
    "This is an untrusted AI-generated proposal, not an approved change.",
  ].filter(Boolean);
  const text = lines.join("\n\n");
  return {
    subject: `[GSW MCP ${p.priority.toUpperCase()}] ${p.title}`.slice(0, 220),
    text,
    html: `<html><body><h2>GSW Mail MCP proposal</h2>${lines.map(line => `<p>${escapeProposalHtml(line)}</p>`).join("")}</body></html>`,
  };
}
