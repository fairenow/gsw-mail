import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userSettings } from "../db/schema.js";

export interface AiCapabilitySettings {
  enabled: boolean;
  mailRead: boolean;
  draftMutation: boolean;
  emailSend: boolean;
  scheduledWork: boolean;
  campaignLaunch: boolean;
  fileAccess: boolean;
}

export const defaultAiCapabilities: AiCapabilitySettings = {
  enabled: true,
  mailRead: true,
  draftMutation: true,
  emailSend: true,
  scheduledWork: true,
  campaignLaunch: true,
  fileAccess: true,
};

export async function getAiCapabilitySettings(userId: string): Promise<AiCapabilitySettings> {
  const [settings] = await db.select({ ai: userSettings.ai }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const ai = settings?.ai ?? {};
  return {
    enabled: ai.enabled !== false,
    mailRead: ai.mailRead !== false,
    draftMutation: ai.draftMutation !== false,
    emailSend: ai.emailSend !== false,
    scheduledWork: ai.scheduledWork !== false,
    campaignLaunch: ai.campaignLaunch !== false,
    fileAccess: ai.fileAccess !== false,
  };
}

export function isAiScopeGloballyEnabled(settings: AiCapabilitySettings, scope: string): boolean {
  if (!settings.enabled) return false;
  if (scope === "mail.read" || scope === "contacts.read" || scope === "calendar.read" || scope === "workspace.read" || scope === "research.use") return settings.mailRead;
  if (scope === "mail.write" || scope === "mail.bulk_write") return settings.draftMutation;
  if (scope === "mail.send") return settings.emailSend;
  if (scope === "automations.read" || scope === "automations.write") return settings.scheduledWork;
  if (scope === "campaign.read" || scope === "campaign.write" || scope === "campaign.send") return settings.campaignLaunch;
  if (scope === "files.read" || scope === "files.write") return settings.fileAccess;
  return true;
}
