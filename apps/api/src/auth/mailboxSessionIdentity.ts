/**
 * Browser-based mailbox OAuth must be bound to the authenticated Better Auth
 * principal selected by the already-authorized application request.
 */
export function assertMailboxSessionIdentity(expectedAuthUserId: string, actualSessionUserId: string | null): void {
  if (!expectedAuthUserId || !actualSessionUserId || actualSessionUserId !== expectedAuthUserId) {
    throw new Error("mailbox_session_identity_mismatch");
  }
}
