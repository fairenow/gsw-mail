/**
 * Bounded, offset-based paging over the mail engine's newest-first JMAP listing.
 * Cursor represents the number of source messages examined, not matching messages:
 * this avoids skipping unread messages when filtering.
 */
export async function pageRecentMessages<T extends { read: boolean }>(
  listPage: (offset: number, limit: number) => Promise<T[]>,
  options: { limit: number; cursor?: string; unreadOnly?: boolean },
): Promise<{ messages: T[]; nextCursor: string | null; scanned: number; complete: boolean }> {
  const { limit, unreadOnly = false } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be between 1 and 50");
  const cursor = options.cursor ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(cursor)) throw new Error("invalid cursor");
  let offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset > 1_000_000) throw new Error("invalid cursor");
  const messages: T[] = [];
  let scanned = 0;
  // Bounded scanning protects the server when a folder contains mostly read mail.
  for (let page = 0; page < 20; page++) {
    const batchSize = unreadOnly ? 100 : limit;
    const batch = await listPage(offset, batchSize);
    if (batch.length > batchSize) throw new Error("mail engine returned oversized page");
    for (const message of batch) {
      offset++;
      scanned++;
      if (!unreadOnly || !message.read) messages.push(message);
      if (messages.length === limit) {
        return { messages, nextCursor: String(offset), scanned, complete: false };
      }
    }
    if (batch.length < batchSize) return { messages, nextCursor: null, scanned, complete: true };
  }
  return { messages, nextCursor: String(offset), scanned, complete: false };
}
