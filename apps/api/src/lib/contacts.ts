import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { contactCustomFields, contactEmails, contactPhones, contactTags, contacts } from "../db/schema.js";

export interface ContactInput {
  firstName?: string | undefined;
  middleName?: string | undefined;
  lastName?: string | undefined;
  displayName?: string | undefined;
  organization?: string | undefined;
  jobTitle?: string | undefined;
  website?: string | undefined;
  address?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  notes?: string | undefined;
  emails?: { email: string; label?: string | undefined; isPrimary?: boolean | undefined }[] | undefined;
  phones?: { phone: string; label?: string | undefined; isPrimary?: boolean | undefined }[] | undefined;
  tags?: string[] | undefined;
  customFields?: Record<string, string | number | boolean | null> | undefined;
  source?: string | undefined;
  sourceFile?: string | undefined;
}

export async function listContacts(ownerUserId: string, query = "") {
  const contactRows = await db.select().from(contacts).where(eq(contacts.ownerUserId, ownerUserId)).orderBy(desc(contacts.lastContactedAt), asc(contacts.displayName)).limit(500);
  return presentContacts(contactRows, query);
}

export async function getContact(ownerUserId: string, id: string) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.ownerUserId, ownerUserId))).limit(1);
  if (!contact) return null;
  return (await presentContacts([contact]))[0] ?? null;
}

export async function createContact(ownerUserId: string, input: ContactInput, metadata?: { importBatchId?: string }) {
  const [contact] = await db.insert(contacts).values({
    ownerUserId,
    firstName: clean(input.firstName), middleName: clean(input.middleName), lastName: clean(input.lastName), displayName: clean(input.displayName),
    organization: clean(input.organization), jobTitle: clean(input.jobTitle), website: clean(input.website), address: clean(input.address), city: clean(input.city),
    state: clean(input.state), postalCode: clean(input.postalCode), country: clean(input.country), notes: clean(input.notes), source: input.source ?? "manual", sourceFile: clean(input.sourceFile),
    importBatchId: metadata?.importBatchId,
  }).returning();
  if (!contact) throw new Error("failed to create contact");
  await replaceChildren(contact.id, input);
  return getContact(ownerUserId, contact.id);
}

export async function updateContact(ownerUserId: string, id: string, input: ContactInput) {
  const existing = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), eq(contacts.ownerUserId, ownerUserId))).limit(1);
  if (!existing[0]) return null;
  await db.update(contacts).set({
    firstName: clean(input.firstName), middleName: clean(input.middleName), lastName: clean(input.lastName), displayName: clean(input.displayName),
    organization: clean(input.organization), jobTitle: clean(input.jobTitle), website: clean(input.website), address: clean(input.address), city: clean(input.city),
    state: clean(input.state), postalCode: clean(input.postalCode), country: clean(input.country), notes: clean(input.notes),
  }).where(eq(contacts.id, id));
  await replaceChildren(id, input);
  return getContact(ownerUserId, id);
}

export async function recordSentRecipients(ownerUserId: string, emails: string[]) {
  for (const email of [...new Set(emails.map(normalizeEmail).filter(Boolean))]) {
    const match = await db.select({ contactId: contactEmails.contactId }).from(contactEmails)
      .innerJoin(contacts, eq(contactEmails.contactId, contacts.id))
      .where(and(eq(contacts.ownerUserId, ownerUserId), eq(contactEmails.normalizedEmail, email))).limit(1);
    const now = new Date();
    if (match[0]) {
      await db.update(contacts).set({ lastContactedAt: now, timesEmailed: await nextEmailCount(match[0].contactId) }).where(eq(contacts.id, match[0].contactId));
    } else {
      const [contact] = await db.insert(contacts).values({ ownerUserId, displayName: email, source: "sent_mail", firstContactedAt: now, lastContactedAt: now, timesEmailed: 1 }).returning({ id: contacts.id });
      if (contact) await db.insert(contactEmails).values({ contactId: contact.id, email, normalizedEmail: email, isPrimary: true });
    }
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function nextEmailCount(contactId: string) {
  const [row] = await db.select({ count: contacts.timesEmailed }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  return (row?.count ?? 0) + 1;
}

async function replaceChildren(contactId: string, input: ContactInput) {
  await db.transaction(async (tx) => {
    await tx.delete(contactEmails).where(eq(contactEmails.contactId, contactId));
    await tx.delete(contactPhones).where(eq(contactPhones.contactId, contactId));
    await tx.delete(contactTags).where(eq(contactTags.contactId, contactId));
    await tx.delete(contactCustomFields).where(eq(contactCustomFields.contactId, contactId));
    const emails = (input.emails ?? []).map((item, index) => ({ contactId, email: item.email.trim(), normalizedEmail: normalizeEmail(item.email), label: clean(item.label), isPrimary: item.isPrimary ?? index === 0 })).filter((item) => item.normalizedEmail);
    if (emails.length) await tx.insert(contactEmails).values(emails);
    const phones = (input.phones ?? []).filter((item) => item.phone.trim()).map((item, index) => ({ contactId, phone: item.phone.trim(), label: clean(item.label), isPrimary: item.isPrimary ?? index === 0 }));
    if (phones.length) await tx.insert(contactPhones).values(phones);
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].map((tag) => ({ contactId, tag, normalizedTag: tag.toLowerCase() }));
    if (tags.length) await tx.insert(contactTags).values(tags);
    const fields = Object.entries(input.customFields ?? {}).filter(([key]) => key.trim()).map(([fieldKey, value]) => ({ contactId, fieldKey: fieldKey.trim(), value }));
    if (fields.length) await tx.insert(contactCustomFields).values(fields);
  });
}

async function presentContacts(rows: typeof contacts.$inferSelect[], query = "") {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [emails, phones, tags, fields] = await Promise.all([
    db.select().from(contactEmails).where(inArray(contactEmails.contactId, ids)),
    db.select().from(contactPhones).where(inArray(contactPhones.contactId, ids)),
    db.select().from(contactTags).where(inArray(contactTags.contactId, ids)),
    db.select().from(contactCustomFields).where(inArray(contactCustomFields.contactId, ids)),
  ]);
  const needle = query.trim().toLowerCase();
  return rows.map((row) => {
    const rowEmails = emails.filter((item) => item.contactId === row.id);
    const rowPhones = phones.filter((item) => item.contactId === row.id);
    const rowTags = tags.filter((item) => item.contactId === row.id).map((item) => item.tag);
    const customFields = Object.fromEntries(fields.filter((item) => item.contactId === row.id).map((item) => [item.fieldKey, item.value]));
    const haystack = [row.displayName, row.firstName, row.lastName, row.organization, row.jobTitle, ...rowEmails.map((item) => item.email), ...rowTags, ...Object.keys(customFields)].filter(Boolean).join(" ").toLowerCase();
    const exact = needle && (rowEmails.some((item) => item.normalizedEmail === needle) || row.displayName?.toLowerCase() === needle) ? 1000 : 0;
    const relevance = needle && haystack.includes(needle) ? 100 : 0;
    return {
      ...row,
      emails: rowEmails.map((item) => ({ email: item.email, normalizedEmail: item.normalizedEmail, ...(item.label ? { label: item.label } : {}), isPrimary: item.isPrimary })),
      phones: rowPhones.map((item) => ({ phone: item.phone, ...(item.label ? { label: item.label } : {}), isPrimary: item.isPrimary })),
      tags: rowTags,
      customFields,
      relevance: exact + relevance,
    };
  }).filter((row) => !needle || row.relevance > 0).sort((a, b) => b.relevance - a.relevance || b.timesEmailed - a.timesEmailed || (new Date(b.lastContactedAt ?? 0).getTime() - new Date(a.lastContactedAt ?? 0).getTime())).slice(0, 50);
}

function clean(value: string | undefined) {
  const result = value?.trim();
  return result || undefined;
}
