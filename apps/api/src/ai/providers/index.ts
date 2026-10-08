import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { anthropicProvider } from "./anthropic.js";
import { hetznerProvider } from "./hetzner.js";
import { huggingFaceProvider } from "./huggingface.js";
import { openAiProvider } from "./openai.js";
import type { AiProvider, AiProviderId } from "./types.js";

const providers: Record<AiProviderId, AiProvider> = {
  hetzner: hetznerProvider,
  openai: openAiProvider,
  anthropic: anthropicProvider,
  huggingface: huggingFaceProvider,
};

export type UserAiModelProvider = "qwen" | "openai" | "claude" | "gpt-oss-120b";

const providerAliases: Record<UserAiModelProvider, AiProviderId> = {
  qwen: "hetzner",
  openai: "openai",
  claude: "anthropic",
  "gpt-oss-120b": "huggingface",
};

export const getAiProvider = (providerId?: string): AiProvider => {
  const requested = providerId ?? config.ai.provider;
  const id = (requested in providerAliases
    ? providerAliases[requested as UserAiModelProvider]
    : requested) as AiProviderId;
  const provider = providers[id];
  if (!provider) throw new HttpError(500, `Unsupported AI provider: ${requested}`);
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
