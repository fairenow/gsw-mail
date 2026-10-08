import type { AgentWorkerId } from "./skills.js";

export interface AgentWorkerProfile {
  id: AgentWorkerId;
  title: string;
  description: string;
  toolPrefixes: string[];
  canDelegate: boolean;
}

export const agentWorkerProfiles: Record<AgentWorkerId, AgentWorkerProfile> = {
  coordinator: {
    id: "coordinator",
    title: "Coordinator",
    description: "Owns the user request, resolves ambiguity, chooses skills, and coordinates multi-step work.",
    toolPrefixes: ["mail.", "automations.", "search.", "contacts.", "campaign.", "templates.", "domain.", "files."],
    canDelegate: true,
  },
  mail: {
    id: "mail",
    title: "Mail worker",
    description: "Specializes in mailbox search, thread understanding, drafts, attachments, and send preparation.",
    toolPrefixes: ["mail.", "contacts.", "templates."],
    canDelegate: false,
  },
  research: {
    id: "research",
    title: "Research worker",
    description: "Specializes in gathering and organizing relevant workspace information before action.",
    toolPrefixes: ["search.", "mail.", "contacts.", "files."],
    canDelegate: false,
  },
  calendar: {
    id: "calendar",
    title: "Calendar worker",
    description: "Reserved for calendar availability, event creation, updates, and invitation responses.",
    toolPrefixes: ["calendar."],
    canDelegate: false,
  },
  files: {
    id: "files",
    title: "Files worker",
    description: "Specializes in finding, analyzing, creating, transforming, and attaching assets.",
    toolPrefixes: ["files.", "mail.attach_file"],
    canDelegate: false,
  },
  campaign: {
    id: "campaign",
    title: "Campaign worker",
    description: "Specializes in audience preparation, personalized outreach, campaigns, and campaign metrics.",
    toolPrefixes: ["campaign.", "contacts.", "templates.", "search.", "mail."],
    canDelegate: false,
  },
  admin: {
    id: "admin",
    title: "Admin worker",
    description: "Specializes in workspace, domain, mailbox, and operational diagnostics under existing admin authorization.",
    toolPrefixes: ["domain.", "admin.", "workspace.", "mailbox_admin.", "alias."],
    canDelegate: false,
  },
};
