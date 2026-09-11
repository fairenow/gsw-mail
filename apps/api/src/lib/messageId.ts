import { randomUUID } from "node:crypto";

export const generateMessageId = (domain = "mail.guidedstepswellness.com"): string => `<${randomUUID()}@${domain}>`;