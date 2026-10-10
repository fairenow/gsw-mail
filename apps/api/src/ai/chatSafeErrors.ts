import { randomBytes } from "node:crypto";

export type SafeChatError = {
  code: string;
  message: string;
  incidentId: string;
  retryable: boolean;
};

const messages: Record<string, string> = {
  mail: "GSW Mail couldn't complete the mailbox request. Please try again.",
  files: "GSW Mail couldn't process the file. Please try again.",
  action: "GSW Mail couldn't complete that action. Please try again.",
  chat: "GSW Chat couldn't complete this request. Please try again.",
};

const safeCode = (value: string): string =>
  /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : "operation_failed";

/** Public-safe error data. Never interpolate exception text into model or client responses. */
export function reportChatError(
  error: unknown,
  context: { operation: string; category?: keyof typeof messages; retryable?: boolean; correlationId?: string },
): SafeChatError {
  const incidentId = "GSW-" + randomBytes(6).toString("hex").toUpperCase();
  const category = context.category ?? "chat";
  const code = safeCode(category + "_failed");
  // Metadata only: raw exception messages, stacks, arguments, URLs and content
  // may contain user data or secrets and are intentionally not logged here.
  console.error(JSON.stringify({
    event: "gsw.chat.error",
    incidentId,
    category,
    code,
    operation: context.operation.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80),
    errorType: error instanceof Error ? error.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 60) : "Unknown",
    ...(error && typeof error === "object" && "status" in error && typeof error.status === "number" ? { httpStatus: error.status } : {}),
    ...(context.correlationId ? { correlationId: context.correlationId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80) } : {}),
  }));
  return {
    code,
    message: messages[category]!,
    incidentId,
    retryable: context.retryable ?? false,
  };
}

export function chatErrorText(error: SafeChatError): string {
  return `${error.message} Reference: ${error.incidentId}`;
}
