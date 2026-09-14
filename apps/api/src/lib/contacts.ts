import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { contactCustomFields, contactEmails, contactPhones, contactTags, contacts, emailAccounts, mailAccountMemberships } from "../db/schema.js";
import { getEngine, getUserEngine } from "../engine/index.js";
import type { EngineContact, EngineContactInput, MailEngine } from "../engine/types.js";
import { paginateContacts } from "./contactPaging.js";

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

export interface ContactEngineContext {
  accountId: string;
  engine: MailEngine;
}

export async function getContactEngineContext(ownerUserId: string, accessToken?: string, authUserId?: string, headers?: Record<string, string>): Promise<ContactEngineContext | undefined> {
  let engine: MailEngine;
  try {
    const [owned] = await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.userId, ownerUserId)).limit(1);
    const account = owned ?? (await db.select({ id: emailAccounts.id }).from(mailAccountMemberships).innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id)).where(eq(mailAccountMemberships.userId, ownerUserId)).limit(1))[0];
    if (!account) {
      engine = getEngine();
    } else if (authUserId && headers) {
      engine = await getUserEngine({ productUserId: ownerUserId, authUserId, accountId: account.id, headers });
    } else {
      throw new Error("user-scoped OAuth context required");
    }
  } catch {
    return undefined;
  }
  const owned = await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.userId, ownerUserId)).limit(1);
  const account = owned[0] ?? (await db.select({ id: emailAccounts.id }).from(mailAccountMemberships).innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id)).where(eq(mailAccountMemberships.userId, ownerUserId)).limit(1))[0];
  if (account) return { engine, accountId: account.id };
  return engine.name === "demo" ? { engine, accountId: ownerUserId } : undefined;
}

export async function listContacts(ownerUserId: string, query = "", limit = 100, offset = 0, context?: ContactEngineContext) {
  const contactRows = await db.select().from(contacts).where(eq(contacts.ownerUserId, ownerUserId)).orderBy(desc(contacts.lastContactedAt), asc(contacts.displayName));
  const presented = await presentContacts(contactRows, query, context);
  return paginateContacts(presented, limit, offset);
}

export async function getContact(ownerUserId: string, id: string, context?: ContactEngineContext) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.ownerUserId, ownerUserId))).limit(1);
  if (!contact) return null;
  return (await presentContacts([contact], "", context))[0] ?? null;
}

export async function createContact(ownerUserId: string, input: ContactInput, metadata?: { importBatchId?: string }, context?: ContactEngineContext) {
  const standard = context ? await createOrFindEngineContact(context, input) : undefined;
  const [contact] = await db.insert(contacts).values({
    ownerUserId,
    firstName: clean(input.firstName), middleName: clean(input.middleName), lastName: clean(input.lastName), displayName: clean(input.displayName),
    organization: clean(input.organization), jobTitle: clean(input.jobTitle), website: clean(input.website), address: clean(input.address), city: clean(input.city),
    state: clean(input.state), postalCode: clean(input.postalCode), country: clean(input.country), notes: clean(input.notes), source: input.source ?? "manual", sourceFile: clean(input.sourceFile),
    ...(standard ? { stalwartContactId: standard.engineId, stalwartAddressBookId: standard.addressBookIds[0] } : {}),
    importBatchId: metadata?.importBatchId,
  }).returning();
  if (!contact) throw new Error("failed to create contact");
  await replaceChildren(contact.id, input);
  return getContact(ownerUserId, contact.id, context);
}

export async function updateContact(ownerUserId: string, id: string, input: ContactInput, context?: ContactEngineContext) {
  const [existing] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.ownerUserId, ownerUserId))).limit(1);
  if (!existing) return null;
  const currentEngineContact = context && existing.stalwartContactId ? (await context.engine.getContact(context.accountId, existing.stalwartContactId)) ?? undefined : undefined;
  const standardInput = mergeEngineContactInput(existing, currentEngineContact, input);
  const standard = context ? existing.stalwartContactId && currentEngineContact ? await context.engine.updateContact(context.accountId, existing.stalwartContactId, standardInput) : await createOrFindEngineContact(context, standardInput) : undefined;
  await db.update(contacts).set({
    firstName: clean(standardInput.firstName), middleName: clean(standardInput.middleName), lastName: clean(standardInput.lastName), displayName: clean(standardInput.displayName),
    organization: clean(standardInput.organization), jobTitle: clean(standardInput.jobTitle), website: clean(standardInput.website), address: clean(standardInput.address), city: clean(standardInput.city),
    state: clean(standardInput.state), postalCode: clean(standardInput.postalCode), country: clean(standardInput.country), notes: clean(input.notes),
    ...(standard ? { stalwartContactId: standard.engineId, stalwartAddressBookId: standard.addressBookIds[0] } : {}),
  }).where(eq(contacts.id, id));
  await replaceChildren(id, { ...input, emails: standardInput.emails.map((item) => ({ email: item.value, label: item.label, isPrimary: item.isPrimary })), phones: standardInput.phones.map((item) => ({ phone: item.value, label: item.label, isPrimary: item.isPrimary })) });
  return getContact(ownerUserId, id, context);
}

export async function recordSentRecipients(ownerUserId: string, emails: string[], context?: ContactEngineContext) {
  for (const email of [...new Set(emails.map(normalizeEmail).filter(Boolean))]) {
    const match = await db.select({ contactId: contactEmails.contactId }).from(contactEmails)
      .innerJoin(contacts, eq(contactEmails.contactId, contacts.id))
      .where(and(eq(contacts.ownerUserId, ownerUserId), eq(contactEmails.normalizedEmail, email))).limit(1);
    const now = new Date();
    if (match[0]) {
      await db.update(contacts).set({ lastContactedAt: now, timesEmailed: await nextEmailCount(match[0].contactId) }).where(eq(contacts.id, match[0].contactId));
    } else {
      const standard = context ? await createOrFindEngineContact(context, { displayName: email, emails: [{ value: email, isPrimary: true }], phones: [] }) : undefined;
      const [contact] = await db.insert(contacts).values({ ownerUserId, displayName: email, source: "sent_mail", firstContactedAt: now, lastContactedAt: now, timesEmailed: 1, ...(standard ? { stalwartContactId: standard.engineId, stalwartAddressBookId: standard.addressBookIds[0] } : {}) }).returning({ id: contacts.id });
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
    const emails = uniqueBy((input.emails ?? []).map((item, index) => ({ contactId, email: item.email.trim(), normalizedEmail: normalizeEmail(item.email), label: clean(item.label), isPrimary: item.isPrimary ?? index === 0 })).filter((item) => item.normalizedEmail), (item) => item.normalizedEmail);
    if (emails.length) await tx.insert(contactEmails).values(emails);
    const phones = uniqueBy((input.phones ?? []).filter((item) => item.phone.trim()).map((item, index) => ({ contactId, phone: item.phone.trim(), label: clean(item.label), isPrimary: item.isPrimary ?? index === 0 })), (item) => item.phone);
    if (phones.length) await tx.insert(contactPhones).values(phones);
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].map((tag) => ({ contactId, tag, normalizedTag: tag.toLowerCase() }));
    if (tags.length) await tx.insert(contactTags).values(tags);
    const fields = Object.entries(input.customFields ?? {}).filter(([key]) => key.trim()).map(([fieldKey, value]) => ({ contactId, fieldKey: fieldKey.trim(), value }));
    if (fields.length) await tx.insert(contactCustomFields).values(fields);
  });
}

async function presentContacts(rows: typeof contacts.$inferSelect[], query = "", context?: ContactEngineContext) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [emails, phones, tags, fields] = await Promise.all([
    db.select().from(contactEmails).where(inArray(contactEmails.contactId, ids)),
    db.select().from(contactPhones).where(inArray(contactPhones.contactId, ids)),
    db.select().from(contactTags).where(inArray(contactTags.contactId, ids)),
    db.select().from(contactCustomFields).where(inArray(contactCustomFields.contactId, ids)),
  ]);
  const engineContacts = context ? await context.engine.listContacts(context.accountId) : [];
  const engineById = new Map(engineContacts.map((contact) => [contact.engineId, contact]));
  if (context) {
    for (const row of rows) {
      if (row.stalwartContactId) continue;
      const rowEmails = emails.filter((item) => item.contactId === row.id);
      const standard = await createOrFindEngineContact(context, {
        firstName: row.firstName ?? undefined,
        middleName: row.middleName ?? undefined,
        lastName: row.lastName ?? undefined,
        displayName: row.displayName ?? undefined,
        organization: row.organization ?? undefined,
        jobTitle: row.jobTitle ?? undefined,
        website: row.website ?? undefined,
        address: row.address ?? undefined,
        city: row.city ?? undefined,
        state: row.state ?? undefined,
        postalCode: row.postalCode ?? undefined,
        country: row.country ?? undefined,
        emails: rowEmails.map((item) => ({ value: item.email, label: item.label ?? undefined, isPrimary: item.isPrimary })),
        phones: [],
      }, engineContacts);
      await db.update(contacts).set({ stalwartContactId: standard.engineId, stalwartAddressBookId: standard.addressBookIds[0] }).where(eq(contacts.id, row.id));
      row.stalwartContactId = standard.engineId;
      row.stalwartAddressBookId = standard.addressBookIds[0] ?? null;
      engineById.set(standard.engineId, standard);
      engineContacts.push(standard);
    }
  }
  const needle = query.trim().toLowerCase();
  return rows.map((row) => {
    const standard = row.stalwartContactId ? engineById.get(row.stalwartContactId) : undefined;
    const rowEmails = emails.filter((item) => item.contactId === row.id);
    const rowPhones = phones.filter((item) => item.contactId === row.id);
    const rowTags = tags.filter((item) => item.contactId === row.id).map((item) => item.tag);
    const customFields = Object.fromEntries(fields.filter((item) => item.contactId === row.id).map((item) => [item.fieldKey, item.value]));
    const presentedEmails = standard?.emails ?? rowEmails.map((item) => ({ value: item.email, label: item.label ?? undefined, isPrimary: item.isPrimary }));
    const presentedPhones = standard?.phones ?? rowPhones.map((item) => ({ value: item.phone, label: item.label ?? undefined, isPrimary: item.isPrimary }));
    const identity = standard ? { ...row, firstName: standard.firstName ?? null, middleName: standard.middleName ?? null, lastName: standard.lastName ?? null, displayName: standard.displayName ?? null, organization: standard.organization ?? null, jobTitle: standard.jobTitle ?? null, website: standard.website ?? null, address: standard.address ?? null, city: standard.city ?? null, state: standard.state ?? null, postalCode: standard.postalCode ?? null, country: standard.country ?? null } : row;
    const haystack = [identity.displayName, identity.firstName, identity.lastName, identity.organization, identity.jobTitle, ...presentedEmails.map((item) => item.value), ...rowTags, ...Object.keys(customFields)].filter(Boolean).join(" ").toLowerCase();
    const exact = needle && (presentedEmails.some((item) => normalizeEmail(item.value) === needle) || identity.displayName?.toLowerCase() === needle) ? 1000 : 0;
    const relevance = needle && haystack.includes(needle) ? 100 : 0;
    return {
      ...identity,
      addressBookIds: standard?.addressBookIds ?? (row.stalwartAddressBookId ? [row.stalwartAddressBookId] : []),
      emails: presentedEmails.map((item) => ({ email: item.value, normalizedEmail: normalizeEmail(item.value), ...(item.label ? { label: item.label } : {}), isPrimary: item.isPrimary === true })),
      phones: presentedPhones.map((item) => ({ phone: item.value, ...(item.label ? { label: item.label } : {}), isPrimary: item.isPrimary === true })),
      tags: rowTags,
      customFields,
      relevance: exact + relevance,
    };
  }).filter((row) => !needle || row.relevance > 0).sort((a, b) => b.relevance - a.relevance || b.timesEmailed - a.timesEmailed || (new Date(b.lastContactedAt ?? 0).getTime() - new Date(a.lastContactedAt ?? 0).getTime()));
}

async function createOrFindEngineContact(context: ContactEngineContext, input: ContactInput | EngineContactInput, known?: EngineContact[]): Promise<EngineContact> {
  const engineInput = toEngineContactInput(input);
  const contacts = known ?? await context.engine.listContacts(context.accountId);
  const emails = new Set(engineInput.emails.map((item) => normalizeEmail(item.value)));
  const existing = contacts.find((contact) => contact.emails.some((item) => emails.has(normalizeEmail(item.value))));
  return existing ?? context.engine.createContact(context.accountId, engineInput);
}

function toEngineContactInput(input: ContactInput | EngineContactInput): EngineContactInput {
  return {
    firstName: input.firstName,
    middleName: input.middleName,
    lastName: input.lastName,
    displayName: input.displayName,
    organization: input.organization,
    jobTitle: input.jobTitle,
    website: input.website,
    address: input.address,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    addressBookIds: "addressBookIds" in input ? input.addressBookIds : undefined,
    emails: (input.emails ?? []).map((item) => "value" in item ? item : { value: item.email, label: item.label, isPrimary: item.isPrimary }),
    phones: (input.phones ?? []).map((item) => "value" in item ? item : { value: item.phone, label: item.label, isPrimary: item.isPrimary }),
  };
}

function mergeEngineContactInput(existing: typeof contacts.$inferSelect, current: EngineContact | undefined, input: ContactInput): EngineContactInput {
  const standard = current ?? {
    engineId: "",
    addressBookIds: existing.stalwartAddressBookId ? [existing.stalwartAddressBookId] : [],
    firstName: existing.firstName ?? undefined,
    middleName: existing.middleName ?? undefined,
    lastName: existing.lastName ?? undefined,
    displayName: existing.displayName ?? undefined,
    organization: existing.organization ?? undefined,
    jobTitle: existing.jobTitle ?? undefined,
    website: existing.website ?? undefined,
    address: existing.address ?? undefined,
    city: existing.city ?? undefined,
    state: existing.state ?? undefined,
    postalCode: existing.postalCode ?? undefined,
    country: existing.country ?? undefined,
    emails: [],
    phones: [],
  };
  return {
    firstName: input.firstName ?? standard.firstName,
    middleName: input.middleName ?? standard.middleName,
    lastName: input.lastName ?? standard.lastName,
    displayName: input.displayName ?? standard.displayName,
    organization: input.organization ?? standard.organization,
    jobTitle: input.jobTitle ?? standard.jobTitle,
    website: input.website ?? standard.website,
    address: input.address ?? standard.address,
    city: input.city ?? standard.city,
    state: input.state ?? standard.state,
    postalCode: input.postalCode ?? standard.postalCode,
    country: input.country ?? standard.country,
    addressBookIds: standard.addressBookIds,
    emails: input.emails ? input.emails.map((item) => ({ value: item.email, label: item.label, isPrimary: item.isPrimary })) : standard.emails,
    phones: input.phones ? input.phones.map((item) => ({ value: item.phone, label: item.label, isPrimary: item.isPrimary })) : standard.phones,
  };
}

function clean(value: string | undefined) {
  const result = value?.trim();
  return result || undefined;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
