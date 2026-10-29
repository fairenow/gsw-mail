import { AsyncLocalStorage } from "node:async_hooks";

const selectedMailboxIdentity = new AsyncLocalStorage<string>();

export function withInternalMailboxIdentity<T>(authUserId: string, authorize: () => T): T {
  return selectedMailboxIdentity.run(authUserId, authorize);
}

export function requiresMailboxAccountSelection(authUserId: string): boolean {
  return !authUserId || selectedMailboxIdentity.getStore() !== authUserId;
}
