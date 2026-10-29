import { badRequest, forbidden } from "../lib/errors.js";
export function assertWorkspaceUserDeletion(input: {
  actorId: string; actorRole: string; targetId: string; targetRole: string;
  ownsMailboxes: boolean; email: string; confirmation: string;
}): void {
  if (!["owner", "admin"].includes(input.actorRole)) throw forbidden();
  if (input.targetId === input.actorId || input.targetRole === "owner") throw forbidden("Workspace owners and your own user cannot be deleted here");
  if (input.targetRole === "admin" && input.actorRole !== "owner") throw forbidden("Only an owner can delete an admin");
  if (input.confirmation !== input.email) throw badRequest("Type the exact user email to confirm deletion");
  if (input.ownsMailboxes) throw badRequest("Delete or reassign this user's mailboxes before deleting the user");
}
