import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";
import { anthropicProvider } from "./anthropic.js";
import { hetznerProvider } from "./hetzner.js";
import { huggingFaceProvider } from "./huggingface.js";
import { modalProvider, modalDeepseekProvider, modalQwenProvider } from "./modal.js";
import { openAiProvider } from "./openai.js";
import type { AiProvider, AiProviderId } from "./types.js";

const providers: Record<AiProviderId, AiProvider> = {
  hetzner: hetznerProvider,
  openai: openAiProvider,
  anthropic: anthropicProvider,
  huggingface: huggingFaceProvider,
  modal: modalProvider,
  "modal-deepseek": modalDeepseekProvider,
  "modal-qwen": {
    id: "modal-qwen",
    async run(input) {
      try {
        return await modalQwenProvider.run(input);
      } catch (error) {
        // Provider inference only: agent tools execute separately after a valid response.
        // Never fail over on unexpected application errors or authorization failures.
        if (!(error instanceof HttpError) || ![429, 502, 503, 504].includes(error.statusCode)) throw error;
        console.warn("[gsw-ai] Modal Qwen unavailable; attempting Hetzner Qwen fallback", { status: error.statusCode });
        return hetznerProvider.run(input);
      }
    },
  },
};

export type UserAiModelProvider = "qwen" | "openai" | "claude" | "gpt-oss-120b" | "deepseek-v4.1-flash" | "qwen-modal";

const providerAliases: Record<UserAiModelProvider, AiProviderId> = {
  qwen: "hetzner",
  openai: "openai",
  claude: "anthropic",
  "gpt-oss-120b": "modal",
  "deepseek-v4.1-flash": "modal-deepseek",
  "qwen-modal": "modal-qwen",
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
