import type { FullMessage } from "../engine/types.js";

export function draftSendRecipients(draft: Pick<FullMessage, "to" | "cc" | "bcc">) {
  return {
    to: draft.to.map((address) => address.email),
    cc: draft.cc.map((address) => address.email),
    bcc: (draft.bcc ?? []).map((address) => address.email),
  };
}
