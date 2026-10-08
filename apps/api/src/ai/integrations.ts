import { config } from "../config.js";

export interface AgentIntegrationDescriptor {
  id: string;
  name: string;
  category: "mail" | "inference" | "delivery" | "storage" | "files" | "browser" | "calendar" | "other";
  configured: boolean;
  capabilities: string[];
  notes?: string | undefined;
}

export function listAgentIntegrations(): AgentIntegrationDescriptor[] {
  return [
    {
      id: "gsw-mail",
      name: "GSW Mail / JMAP",
      category: "mail",
      configured: config.mailEngine === "stalwart" || config.mailEngine === "demo",
      capabilities: ["mail", "contacts", "calendar", "domains", "aliases"],
    },
    {
      id: "huggingface",
      name: "Hugging Face Inference",
      category: "inference",
      configured: Boolean(config.ai.huggingFaceApiToken),
      capabilities: ["chat", "tool-calling", "reasoning", "image-generation"],
      notes: config.ai.huggingFaceChatModel,
    },
    {
      id: "openai",
      name: "OpenAI",
      category: "inference",
      configured: Boolean(config.ai.openaiApiKey),
      capabilities: ["chat", "file-intelligence", "artifact-generation", "image-generation", "transcription"],
      notes: config.ai.openaiModel ?? undefined,
    },
    {
      id: "anthropic",
      name: "Anthropic",
      category: "inference",
      configured: Boolean(config.ai.anthropicApiKey),
      capabilities: ["chat", "tool-calling"],
      notes: config.ai.anthropicModel ?? undefined,
    },
    {
      id: "resend",
      name: "Resend",
      category: "delivery",
      configured: Boolean(config.outbound.resendApiKey),
      capabilities: ["transactional-email", "campaign-delivery"],
    },
    {
      id: "r2",
      name: "Cloudflare R2",
      category: "storage",
      configured: Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket),
      capabilities: ["private-files", "generated-assets", "attachments"],
      notes: config.r2.bucket,
    },
    {
      id: "browser",
      name: "Browser worker",
      category: "browser",
      configured: Boolean(config.browser.baseUrl && config.browser.token),
      capabilities: ["web-search", "open-page", "read-page", "screenshot", "bounded-click", "bounded-type"],
      notes: config.browser.baseUrl ? "Isolated browser provider configured." : "Set BROWSER_WORKER_BASE_URL and BROWSER_WORKER_TOKEN to enable.",
    },
  ];
}
