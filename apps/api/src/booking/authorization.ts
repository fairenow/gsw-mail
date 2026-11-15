import { authorizeRenewableStalwartMailbox } from "../auth/stalwartToken.js";
import { loadMailboxCredential } from "../auth/mailboxCredentialVault.js";
import { getUserEngine } from "../engine/index.js";
import { serviceUnavailable } from "../lib/errors.js";
export async function ensureBookingMailboxAuthorization(
  input: {
    productUserId: string;
    authUserId: string;
    accountId: string;
    headers: Record<string, string>;
  },
  dependencies = {
    load: loadMailboxCredential,
    renew: authorizeRenewableStalwartMailbox,
    engine: getUserEngine,
  },
) {
  const principal = {
    productUserId: input.productUserId,
    authUserId: input.authUserId,
    accountId: input.accountId,
  };
  if (!(await dependencies.load(principal))) {
    if (!input.headers.cookie) throw serviceUnavailable("Background booking authorization is required. Open Event Link in GSW Mail on the web and save the enabled link once for this mailbox. You can save a paused draft from the mobile app first.");
    await dependencies.renew(input);
  }
  if (!(await dependencies.load(principal)))
    throw serviceUnavailable(
      "Your mailbox could not authorize background bookings. Reconnect the mailbox and save this event link again.",
    );
  return dependencies.engine({
    ...principal,
    headers: {},
    permission: "manage",
  });
}
