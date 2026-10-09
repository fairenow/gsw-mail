import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userSettings } from "../db/schema.js";

export type AiModelProvider = "qwen" | "openai" | "claude" | "gpt-oss-120b";

export interface AiCapabilitySettings {
  enabled: boolean;
  modelProvider: AiModelProvider;
  mailRead: boolean;
  draftMutation: boolean;
  emailSend: boolean;
  scheduledWork: boolean;
  campaignLaunch: boolean;
  fileAccess: boolean;
  imageGeneration: boolean;
}

export const defaultAiCapabilities: AiCapabilitySettings = {
  enabled: true,
  modelProvider: "gpt-oss-120b",
  mailRead: true,
  draftMutation: true,
  emailSend: true,
  scheduledWork: true,
  campaignLaunch: true,
  fileAccess: true,
  imageGeneration: true,
};

export async function getAiCapabilitySettings(userId: string): Promise<AiCapabilitySettings> {
  const [settings] = await db.select({ ai: userSettings.ai }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const ai = settings?.ai ?? {};
  const requestedProvider = ai.modelProvider;
  const modelProvider: AiModelProvider = requestedProvider === "openai" || requestedProvider === "claude" || requestedProvider === "qwen" || requestedProvider === "gpt-oss-120b"
    ? requestedProvider
    : "gpt-oss-120b";
  return {
    enabled: ai.enabled !== false,
    modelProvider,
    mailRead: ai.mailRead !== false,
    draftMutation: ai.draftMutation !== false,
    emailSend: ai.emailSend !== false,
    scheduledWork: ai.scheduledWork !== false,
    campaignLaunch: ai.campaignLaunch !== false,
    fileAccess: ai.fileAccess !== false,
    imageGeneration: ai.imageGeneration !== false,
  };
}

export function isAiScopeGloballyEnabled(settings: AiCapabilitySettings, scope: string): boolean {
  if (!settings.enabled) return false;
  if (scope === "mail.read" || scope === "contacts.read" || scope === "calendar.read" || scope === "workspace.read" || scope === "research.use") return settings.mailRead;
  if (scope === "contacts.write" || scope === "calendar.write" || scope === "mail.write" || scope === "mail.bulk_write") return settings.draftMutation;
  if (scope === "mail.send") return settings.emailSend;
  if (scope === "automations.read" || scope === "automations.write" || scope === "tasks.read" || scope === "tasks.write") return settings.scheduledWork;
  if (scope === "campaign.read" || scope === "campaign.write" || scope === "campaign.send") return settings.campaignLaunch;
  if (scope === "files.read" || scope === "files.write") return settings.fileAccess;
  if (scope === "images.generate" || scope === "videos.generate") return settings.imageGeneration;
  if (scope === "browser.read" || scope === "browser.write") return true;
  return true;
}
