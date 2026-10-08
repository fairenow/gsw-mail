export type AgentWorkerId =
  | "coordinator"
  | "mail"
  | "research"
  | "calendar"
  | "files"
  | "campaign"
  | "browser"
  | "admin";

export interface AgentSkillDefinition {
  id: string;
  title: string;
  description: string;
  worker: AgentWorkerId;
  keywords: string[];
  toolPrefixes: string[];
  toolNames?: string[];
}

export const agentSkills: AgentSkillDefinition[] = [
  {
    id: "mail_triage",
    title: "Mail triage",
    description: "Find, inspect, summarize, organize, and prepare responses for mailbox work.",
    worker: "mail",
    keywords: ["email", "mail", "inbox", "thread", "reply", "draft", "message", "follow-up", "followup", "archive", "unread"],
    toolPrefixes: ["mail."],
  },
  {
    id: "outreach_work",
    title: "Outreach work",
    description: "Research recipients, manage contacts, prepare personalized drafts, and coordinate outreach.",
    worker: "campaign",
    keywords: ["outreach", "prospect", "lead", "recipient", "campaign", "personalize", "follow-up", "followup"],
    toolPrefixes: ["campaign.", "contacts.", "mail.", "search."],
  },
  {
    id: "campaign_management",
    title: "Campaign management",
    description: "Create, inspect, prepare, and launch permissioned campaigns.",
    worker: "campaign",
    keywords: ["campaign", "broadcast", "audience", "segment", "launch", "marketing"],
    toolPrefixes: ["campaign.", "contacts.", "templates.", "search."],
  },
  {
    id: "file_work",
    title: "File and document work",
    description: "Find, analyze, create, transform, save, and attach files or generated assets.",
    worker: "files",
    keywords: ["file", "pdf", "document", "spreadsheet", "excel", "xlsx", "docx", "presentation", "pptx", "image", "attachment", "attach", "banner", "thumbnail"],
    toolPrefixes: ["files.", "mail.attach_file"],
  },
  {
    id: "scheduled_work",
    title: "Scheduled work",
    description: "Create and manage durable recurring or future agent tasks.",
    worker: "coordinator",
    keywords: ["remind", "reminder", "every day", "daily", "weekly", "monthly", "schedule", "monitor", "check later", "automation", "recurring"],
    toolPrefixes: ["automations."],
  },
  {
    id: "contact_management",
    title: "Contact management",
    description: "Work with contact tags and recipient context.",
    worker: "mail",
    keywords: ["contact", "contacts", "tag", "person", "people", "recipient"],
    toolPrefixes: ["contacts.", "mail.", "search."],
  },
  {
    id: "template_work",
    title: "Template work",
    description: "Find, create, update, and select reusable email templates.",
    worker: "mail",
    keywords: ["template", "signature", "email design", "reuse", "reusable"],
    toolPrefixes: ["templates.", "files.", "mail."],
  },
  {
    id: "workspace_research",
    title: "Workspace research",
    description: "Search across available workspace context and combine findings with mail/contact work.",
    worker: "research",
    keywords: ["research", "find", "look up", "search", "investigate", "compare", "company", "organization"],
    toolPrefixes: ["search.", "mail.", "contacts.", "files."],
  },
  {
    id: "browser_research",
    title: "Browser research",
    description: "Use an isolated browser worker to research public websites and inspect web pages without exposing the production server.",
    worker: "browser",
    keywords: ["website", "web", "browser", "online", "internet", "site", "portal", "research company", "download page"],
    toolPrefixes: ["browser.", "files.", "search."],
  },
  {
    id: "domain_admin",
    title: "Domain and admin diagnostics",
    description: "Inspect domain and workspace administration state without bypassing role checks.",
    worker: "admin",
    keywords: ["domain", "dns", "mailbox admin", "admin", "workspace", "health", "delivery", "configuration"],
    toolPrefixes: ["domain."],
  },
];

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

export function selectAgentSkills(input: string, limit = 4): AgentSkillDefinition[] {
  const text = normalize(input);
  if (!text) return [];
  return agentSkills
    .map((skill) => ({
      skill,
      score: skill.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.title.localeCompare(b.skill.title))
    .slice(0, Math.max(1, Math.min(limit, 8)))
    .map((entry) => entry.skill);
}

export function skillToolMatch(skill: AgentSkillDefinition, toolName: string): boolean {
  if (skill.toolNames?.includes(toolName)) return true;
  return skill.toolPrefixes.some((prefix) => toolName === prefix || toolName.startsWith(prefix));
}
