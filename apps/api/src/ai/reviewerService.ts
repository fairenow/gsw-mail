import { getAiCapabilitySettings } from "./capabilities.js";
import { getAiProvider, type AiProviderMessage } from "./providers/index.js";

const reviewerPrompt = [
  "You are the GSW Reviewer, a bounded quality-control worker inside GSW Mail.",
  "Review prepared work before the main coordinator asks the user to approve or use it.",
  "Do not execute tools or take actions.",
  "Check for wrong recipient or identity assumptions, unsupported factual claims, missing requested details, wrong account/sender assumptions, duplicate outreach risk, attachment or scheduling inconsistencies, and tone/clarity problems.",
  "Separate blocking issues from optional improvements.",
  "If the work appears safe and complete, say APPROVED on the first line.",
  "If it needs correction before use, say NEEDS_REVISION on the first line.",
  "Keep the review concise and actionable.",
].join(" ");

export async function runReviewer(input: {
  userId: string;
  workType: string;
  content: string;
  context?: string;
}) {
  const settings = await getAiCapabilitySettings(input.userId);
  const provider = getAiProvider(settings.modelProvider);
  const messages: AiProviderMessage[] = [
    { role: "user", content: reviewerPrompt },
    {
      role: "user",
      content: [
        `Work type: ${input.workType}`,
        ...(input.context ? [`Context:\n${input.context.slice(0, 12_000)}`] : []),
        `Prepared work:\n${input.content.slice(0, 24_000)}`,
      ].join("\n\n"),
    },
  ];
  const result = await provider.run({ messages });
  return {
    verdict: result.content?.trim().startsWith("APPROVED") ? "approved" as const : "needs_revision" as const,
    review: result.content?.trim() || "NEEDS_REVISION\nThe reviewer returned no usable feedback.",
    model: result.model,
  };
}
