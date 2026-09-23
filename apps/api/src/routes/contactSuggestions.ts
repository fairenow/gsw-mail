import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { contactEmails, contacts } from "../db/schema.js";

export default async function contactSuggestions(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/contact-suggestions", async (req) => {
    const query = String((req.query as { q?: unknown })?.q ?? "").trim();
    if (query.length < 2) return { contacts: [] };

    const needle = `%${query}%`;
    const rows = await db
      .select({
        id: contacts.id,
        displayName: contacts.displayName,
        organization: contacts.organization,
        jobTitle: contacts.jobTitle,
        email: contactEmails.email,
        isPrimary: contactEmails.isPrimary,
        timesEmailed: contacts.timesEmailed,
        lastContactedAt: contacts.lastContactedAt,
      })
      .from(contacts)
      .innerJoin(contactEmails, eq(contactEmails.contactId, contacts.id))
      .where(and(
        eq(contacts.ownerUserId, req.user!.id),
        or(
          ilike(contacts.displayName, needle),
          ilike(contacts.firstName, needle),
          ilike(contacts.lastName, needle),
          ilike(contacts.organization, needle),
          ilike(contacts.jobTitle, needle),
          ilike(contactEmails.email, needle),
        ),
      ))
      .orderBy(desc(contactEmails.isPrimary), desc(contacts.timesEmailed), desc(contacts.lastContactedAt))
      .limit(60);

    const seen = new Set<string>();
    const suggestions = [] as Array<{ id: string; displayName: string | null; organization: string | null; jobTitle: string | null; email: string }>;
    for (const row of rows) {
      const normalized = row.email.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      suggestions.push({ id: row.id, displayName: row.displayName, organization: row.organization, jobTitle: row.jobTitle, email: row.email });
      if (suggestions.length >= 20) break;
    }

    return { contacts: suggestions };
  });
}
