export interface ImportedEmail {
  email: string;
  label?: string | undefined;
  isPrimary?: boolean | undefined;
}

export function validateImportedEmails(emails: ImportedEmail[] | undefined): ImportedEmail[] {
  if (!emails?.length) throw new Error("an email column is required");
  const seen = new Set<string>();
  const unique: ImportedEmail[] = [];
  for (const item of emails) {
    const email = item.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`invalid email "${email}"`);
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push({ ...item, email });
  }
  return unique;
}

export function mergeImportedEmails(current: ImportedEmail[], incoming: ImportedEmail[]): ImportedEmail[] {
  return validateImportedEmails([...current, ...incoming]);
}
