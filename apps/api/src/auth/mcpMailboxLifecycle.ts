/** Contract test seam for first-party mailbox authorization and later sessionless
 * MCP access. Production adapters must independently enforce user/account ACLs,
 * signed JWT audience/subject/email binding, and Stalwart authorization.
 * Never use an external MCP bearer as a first-party mailbox credential.
 */
export async function exerciseMcpMailboxLifecycle(input: {
  establishFirstPartyGrant: () => Promise<void>;
  loadPersistedGrant: () => Promise<string | null>;
  refreshAndVerify: (refreshGrant: string) => Promise<string>;
  readInboxViaSessionlessMcp: (accessToken: string) => Promise<readonly string[]>;
}): Promise<readonly string[]> {
  await input.establishFirstPartyGrant();
  const grant = await input.loadPersistedGrant();
  if (!grant) throw new Error("mailbox_refresh_credential_not_persisted");
  const token = await input.refreshAndVerify(grant);
  if (!token) throw new Error("mailbox_refresh_credential_unusable");
  return input.readInboxViaSessionlessMcp(token);
}
