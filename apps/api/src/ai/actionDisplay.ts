import type { AiScope } from "./permissions/types.js";

const actionLabels: Record<string, string> = {
  "videos.generate": "generate a video",
  "video.generate": "generate a video",
  "files.generate_image": "generate an image",
  "files.create_artifact": "create a document",
  "files.create_text": "create a text file",
  "files.transform": "edit a file",
  "mail.attach_file": "attach a file to a draft",
  "mail.send_draft": "send a prepared email",
  "campaign.launch": "launch a campaign",
  "automations.create": "create scheduled work",
  "automations.update": "change scheduled work",
  "automations.delete": "delete scheduled work",
};

const scopeLabels: Partial<Record<AiScope, string>> = {
  "videos.generate": "generate videos",
  "images.generate": "generate images",
  "files.write": "create and update files",
  "files.read": "access your files",
  "mail.read": "read mailbox messages",
  "mail.write": "manage drafts",
  "mail.send": "send email",
  "campaign.send": "launch campaigns",
  "tasks.write": "create and manage tasks",
  "tasks.read": "view scheduled tasks",
  "calendar.read": "view your calendar",
  "calendar.write": "manage calendar events",
  "contacts.read": "view contacts",
  "contacts.write": "manage contacts",
  "templates.read": "view email templates",
  "templates.write": "edit email templates",
  "signatures.read": "view email signatures",
  "signatures.write": "edit email signatures",
  "automations.read": "view scheduled work",
  "automations.write": "manage scheduled work",
  "campaign.read": "view campaigns",
  "campaign.write": "prepare campaigns",
  "research.use": "research information",
  "browser.read": "browse websites",
  "browser.write": "interact with websites",
  "settings.read": "view your settings",
  "settings.write": "change settings",
  "workspace.read": "view workspace information",
  "workspace.admin": "administer this workspace",
  "domain.read": "view domain information",
  "domain.write": "manage domains",
  "alias.read": "view email aliases",
  "alias.write": "manage email aliases",
  "mailbox_admin.read": "view mailbox administration details",
  "mailbox_admin.write": "manage mailboxes",
  "admin.health.read": "view service health",
  "admin.audit.read": "view audit information",
  "mail.bulk_write": "manage multiple drafts",
};

function readableIdentifier(value: string): string {
  return value.replaceAll("__", ".").split(".").flatMap((part) => part.split(/[_-]/)).filter(Boolean).join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function actionDisplayLabel(action: string): string {
  return actionLabels[action.replaceAll("__", ".")] ?? readableIdentifier(action);
}

export function permissionCopyForScope(scope: AiScope): { title: string; description: string } {
  if (scope === "videos.generate") return {
    title: "Allow GSW Chat to generate videos?",
    description: "GSW Chat can create videos when you request them. Generation may continue in the background, and completed videos are saved to your private GSW Files.",
  };
  const label = scopeLabels[scope] ?? readableIdentifier(scope);
  return {
    title: "Allow GSW Chat to " + label + "?",
    description: "This gives GSW Chat permission to " + label + " when you request it. Actions still follow your existing access and confirmation settings.",
  };
}

export function confirmationSummaryForAction(action: string): string {
  const normalized = action.replaceAll("__", ".");
  switch (normalized) {
    case "mail.send_draft": return "Send this prepared draft now? This will deliver the email to its recipients.";
    case "campaign.launch": return "Launch this campaign now? Messages will be queued for its audience.";
    case "automations.create": return "Create this scheduled task? It can run in the background.";
    case "automations.update": return "Apply these changes to the scheduled task?";
    case "automations.delete": return "Permanently delete this scheduled task?";
    default: return "Allow GSW Chat to " + actionDisplayLabel(normalized) + "?";
  }
}
