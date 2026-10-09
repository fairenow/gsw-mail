import type { AiCapabilitySettings } from "./capabilities.js";
import { isAiScopeGloballyEnabled } from "./capabilities.js";
import { selectAgentSkills, skillToolMatch } from "./skills.js";
import type { AgentToolDefinition, ProviderToolDefinition } from "./tools/types.js";
import { agentMailRegistry } from "./tools/registry.js";

const coreToolNames = new Set([
  "mail.search",
  "mail.read",
  "mail.read_thread",
]);

const toolAvailable = (
  tool: AgentToolDefinition,
  settings: AiCapabilitySettings,
  hasOpenAi: boolean,
  hasImageProvider: boolean,
  hasBrowserProvider: boolean,
) => {
  if (!tool.requiredScopes.every((scope) => isAiScopeGloballyEnabled(settings, scope))) return false;
  if (tool.name === "files.transform" && !hasOpenAi) return false;
  if (tool.name === "files.generate_image" && !hasImageProvider) return false;
  if (tool.name.startsWith("browser.") && !hasBrowserProvider) return false;
  return true;
};

export function selectAgentTools(input: {
  userMessage: string;
  capabilitySettings: AiCapabilitySettings;
  hasOpenAi: boolean;
  hasImageProvider: boolean;
  hasBrowserProvider: boolean;
}): {
  tools: ProviderToolDefinition[];
  selectedToolNames: string[];
  selectedSkillIds: string[];
  dynamic: boolean;
} {
  const available = agentMailRegistry.definitions().filter((tool) =>
    toolAvailable(tool, input.capabilitySettings, input.hasOpenAi, input.hasImageProvider, input.hasBrowserProvider),
  );
  const skills = selectAgentSkills(input.userMessage);
  const videoRequested = /\b(?:video|animate|animation|moving clip|motion clip)\b/i.test(input.userMessage);

  if (skills.length === 0) {
    return {
      tools: agentMailRegistry.providerDefinitions((tool) => available.includes(tool)),
      selectedToolNames: available.map((tool) => tool.name),
      selectedSkillIds: [],
      dynamic: false,
    };
  }

  const selected = available.filter((tool) =>
    coreToolNames.has(tool.name) || (videoRequested && tool.name === "videos.generate") || tool.name === "capabilities.search" || tool.name.startsWith("workers.") || tool.name === "integrations.list" || tool.name.startsWith("tasks.") || skills.some((skill) => skillToolMatch(skill, tool.name)),
  );

  const minimum = selected.length >= 3 ? selected : available;
  return {
    tools: minimum.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name.replaceAll(".", "__"),
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    selectedToolNames: minimum.map((tool) => tool.name),
    selectedSkillIds: skills.map((skill) => skill.id),
    dynamic: minimum !== available,
  };
}
