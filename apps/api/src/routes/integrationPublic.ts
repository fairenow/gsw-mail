import type { FastifyInstance } from "fastify";
import { mailboxOperations } from "../integrations/operations.js";

export default async function integrationPublic(app: FastifyInstance) {
  const overview = async () => ({ service: "GSW Mailbox API", version: "v1", baseUrl: "https://mail.guidedstepswellness.com/integrations/v1", documentation: "https://mail-docs.guidedstepswellness.com", authentication: "Send Authorization: Bearer YOUR_SERVER_KEY from your application server. Admin browser sign-in does not authenticate API requests.", endpoints: ["GET /connection", "GET /capabilities", "POST /operations", "POST /emails", "GET /emails/{id}", "POST /ai/chat"] });
  app.get("/integrations/v1", overview);
  app.get("/integrations/v1/", overview);
  app.get("/integrations/v1/reference", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return { access: "mailbox.full", operations: mailboxOperations.capabilities() };
  });
}
