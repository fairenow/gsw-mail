/**
 * Determines whether a cold, user-scoped Stalwart OAuth exchange can be
 * attempted. A third-party MCP bearer is not an internal Stalwart credential.
 * Call only after checking direct native bearer and existing token cache.
 */
export function canAttemptInteractiveMailboxAuthorization(headers: Readonly<Record<string, string>>): boolean {
  return typeof headers.cookie === "string" && headers.cookie.trim().length > 0;
}
