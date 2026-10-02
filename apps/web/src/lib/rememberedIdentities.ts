export type RememberedGswIdentity = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  lastUsedAt: string;
};

const STORAGE_KEY = "gsw-remembered-identities-v1";
const PREFILL_KEY = "gsw-auth-prefill-email";
const MAX_IDENTITIES = 8;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getRememberedIdentities(): RememberedGswIdentity[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RememberedGswIdentity => Boolean(
        item && typeof item === "object"
        && typeof (item as RememberedGswIdentity).id === "string"
        && typeof (item as RememberedGswIdentity).email === "string"
        && typeof (item as RememberedGswIdentity).name === "string"
        && typeof (item as RememberedGswIdentity).lastUsedAt === "string",
      ))
      .slice(0, MAX_IDENTITIES);
  } catch {
    return [];
  }
}

export function rememberIdentity(identity: Omit<RememberedGswIdentity, "lastUsedAt"> & { lastUsedAt?: string }): void {
  if (!canUseStorage()) return;
  const normalized: RememberedGswIdentity = {
    id: identity.id,
    email: identity.email.toLowerCase(),
    name: identity.name || identity.email,
    image: identity.image ?? null,
    lastUsedAt: identity.lastUsedAt ?? new Date().toISOString(),
  };
  const next = [normalized, ...getRememberedIdentities().filter((item) => item.id !== normalized.id && item.email.toLowerCase() !== normalized.email)]
    .slice(0, MAX_IDENTITIES);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function setAuthPrefillEmail(email: string): void {
  window.sessionStorage.setItem(PREFILL_KEY, email);
}

export function consumeAuthPrefillEmail(): string {
  const value = window.sessionStorage.getItem(PREFILL_KEY) ?? "";
  window.sessionStorage.removeItem(PREFILL_KEY);
  return value;
}
