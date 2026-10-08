import { config } from "../../config.js";
import { HttpError } from "../../lib/errors.js";

export type BrowserAction =
  | "search"
  | "open"
  | "read"
  | "screenshot"
  | "click"
  | "type";

export interface BrowserActionResult {
  sessionId?: string;
  url?: string;
  title?: string;
  text?: string;
  data?: unknown;
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
}

export async function runBrowserAction(input: {
  action: BrowserAction;
  userId: string;
  accountId: string;
  payload: Record<string, unknown>;
}): Promise<BrowserActionResult> {
  if (!config.browser.baseUrl || !config.browser.token) {
    throw new HttpError(503, "Browser worker is not configured for this deployment.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.browser.timeoutMs);
  try {
    const response = await fetch(`${config.browser.baseUrl.replace(/\/$/, "")}/v1/actions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.browser.token}`,
        "content-type": "application/json",
        "x-gsw-user-id": input.userId,
        "x-gsw-account-id": input.accountId,
      },
      body: JSON.stringify({
        action: input.action,
        input: input.payload,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as {
      error?: string | { message?: string };
      message?: string;
      result?: BrowserActionResult;
    };
    if (!response.ok) {
      const message = typeof body.error === "string"
        ? body.error
        : body.error?.message ?? body.message ?? `Browser worker returned HTTP ${response.status}`;
      throw new HttpError(response.status === 429 ? 429 : 502, message);
    }
    return body.result ?? body as BrowserActionResult;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpError(504, "Browser worker timed out.");
    }
    throw new HttpError(
      502,
      error instanceof Error ? `Browser worker failed: ${error.message}` : "Browser worker failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
