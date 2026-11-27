import type { MailEngine } from "../engine/types.js";
import { badRequest, notFound } from "./errors.js";

// Read the sender from the authorized mailbox, never from client input.
export async function markSenderNotSpam(
  engine: Pick<MailEngine, "getMessage" | "listMailboxes" | "move">,
  accountId: string,
  messageId: string,
  trust: (email: string) => Promise<void>,
): Promise<string | null> {
  const message = await engine.getMessage(accountId, messageId);
  if (!message) throw notFound("message not found");
  const junk = (await engine.listMailboxes(accountId)).find(mailbox => mailbox.role === "spam");
  if (!junk || (message.mailbox !== junk.engineName && message.mailbox !== junk.engineId)) {
    throw badRequest("Only messages in Spam can be marked not spam");
  }
  const sender = message.from?.email?.trim().toLowerCase();
  // A message without a usable From address can still be restored, but cannot
  // create a sender preference. No domain-wide or wildcard rules are created.
  const email = sender && /^[^\s@<>*,]+@[^\s@<>*,]+$/.test(sender) ? sender : null;
  if (email) await trust(email);
  await engine.move(accountId, [messageId], "Inbox");
  return email;
}
