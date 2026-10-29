import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { deleteAdminMailbox, deleteAdminUser } from "../services/adminDeletion.js";
export default async function adminDeletion(app: FastifyInstance) {
  await requireUser(app, { optional: false });
  app.delete<{ Params: { id: string } }>("/admin/mailboxes/:id", req => deleteAdminMailbox({ userId:req.user!.id,authUserId:req.authUserId ?? "",request:req },req.params.id,req.body));
  app.delete<{ Params: { id: string } }>("/admin/users/:id", req => deleteAdminUser({ userId:req.user!.id,authUserId:req.authUserId ?? "",request:req },req.params.id,req.body));
}
