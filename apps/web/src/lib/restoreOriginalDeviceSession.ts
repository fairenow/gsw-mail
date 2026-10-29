import type { AuthSession, DeviceSession } from "../auth";

interface SessionOperations {
  list: () => Promise<DeviceSession[]>;
  activate: (token: string) => Promise<unknown>;
  current: () => Promise<AuthSession | null>;
}

export async function restoreOriginalDeviceSession(userId: string, operations: SessionOperations): Promise<void> {
  const sessions = await operations.list();
  const original = sessions.find(item => item.user.id === userId);
  if (!original) throw new Error("This mailbox session has expired. Copy your unsaved message, then sign in again.");
  await operations.activate(original.session.token);
  const current = await operations.current();
  if (current?.user.id !== userId) throw new Error("Could not restore this account. Please try again.");
}
