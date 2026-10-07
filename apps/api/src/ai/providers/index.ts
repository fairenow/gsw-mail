import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { anthropicProvider } from "./anthropic.js";
import { hetznerProvider } from "./hetzner.js";
import { openAiProvider } from "./openai.js";
import type { AiProvider, AiProviderId } from "./types.js";

const providers: Record<AiProviderId, AiProvider> = {
  hetzner: hetznerProvider,
  openai: openAiProvider,
  anthropic: anthropicProvider,
};

export const getAiProvider = (providerId?: string): AiProvider => {
  const id = (providerId ?? config.ai.provider) as AiProviderId;
  const provider = providers[id];
  if (!provider) throw new HttpError(500, `Unsupported AI provider: ${id}`);
  return provider;
};

export type {
  AiChatRole,
  AiProvider,
  AiProviderId,
  AiProviderMessage,
  AiProviderRunInput,
  AiProviderRunResult,
  AiToolCall,
} from "./types.js";
