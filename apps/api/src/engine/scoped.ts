import type { MailEngine } from "./types.js";

type AccountMethod = Exclude<keyof MailEngine, "name" | "status">;

export function scopedMailEngine(resolve: (accountId: string) => Promise<MailEngine>, health: MailEngine): MailEngine {
  const call = <K extends AccountMethod>(method: K) => async (...args: Parameters<MailEngine[K]>): Promise<Awaited<ReturnType<MailEngine[K]>>> => {
    const engine = await resolve(args[0]);
    return Reflect.apply(engine[method], engine, args);
  };
  return {
    name: health.name,
    status: () => health.status(),
    listMailboxes: call("listMailboxes"),
    listMailboxStats: call("listMailboxStats"),
    listMessages: call("listMessages"),
    getMessage: call("getMessage"),
    getThread: call("getThread"),
    setSeen: call("setSeen"),
    setFlagged: call("setFlagged"),
    move: call("move"),
    destroy: call("destroy"),
    saveDraft: call("saveDraft"),
    updateDraft: call("updateDraft"),
    saveSent: call("saveSent"),
    findMessageByRfcMessageId: call("findMessageByRfcMessageId"),
    getAttachment: call("getAttachment"),
    listAddressBooks: call("listAddressBooks"),
    listCalendars: call("listCalendars"),
    listCalendarEvents: call("listCalendarEvents"),
    listContacts: call("listContacts"),
    getContact: call("getContact"),
    createContact: call("createContact"),
    updateContact: call("updateContact"),
    search: call("search"),
  };
}
