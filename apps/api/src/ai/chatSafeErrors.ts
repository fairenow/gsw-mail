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
  calendar: "Calendar information is unavailable. Please retry.",
  chat: "GSW Chat couldn't complete this request. Please try again.",
};

const safeCode = (value: string): string =>
  /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : "operation_failed";

// Only our own fixed mailbox-credential denial strings are eligible for logging.
// Exception messages may contain user data or secrets and must never be logged.
const knownCredentialReasons = new Set([
  "mailbox_session_required",
  "mailbox_session_identity_mismatch",
  "mailbox identity is not linked to this Better Auth session",
  "mailbox is not ready for mail access",
  "mail account not found",
  "invalid_mailbox_token",
  "mailbox_token_claims_mismatch",
  "Background mailbox authorization is not available",
]);

export function safeErrorReason(error: unknown): string | undefined {
  if (error instanceof Error && knownCredentialReasons.has(error.message)) return error.message;
  return undefined;
}

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
  const errorDetails = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const safeErrorCode = typeof errorDetails.code === "string" && /^[A-Z0-9_]{2,48}$/i.test(errorDetails.code) ? errorDetails.code : undefined;
  const reason = safeErrorReason(error);
  console.error(JSON.stringify({
    event: "gsw.chat.error",
    incidentId,
    category,
    code,
    ...(safeErrorCode ? { upstreamCode: safeErrorCode } : {}),
    ...(reason ? { reason } : {}),
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
