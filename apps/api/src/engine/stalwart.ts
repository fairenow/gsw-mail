import { config } from "../config.js";
import type {
  EngineAccountId,
  EngineMessageId,
  EngineThreadId,
  FullMessage,
  MailboxName,
  MailEngine,
  MailEngineStatus,
  MessageQuery,
  MessageSummary,
  SendDraftInput,
  SendResult,
} from "./types.js";

class NotImplemented extends Error {
  constructor(method: string) {
    super(`${method} is not implemented for the stalwart engine yet`);
    this.name = "NotImplemented";
  }
}

export class StalwartEngine implements MailEngine {
  readonly name = "stalwart";

  readonly jmapUrl: string;
  readonly adminToken: string;

  constructor() {
    this.jmapUrl = config.stalwart.jmapUrl;
    this.adminToken = config.stalwart.adminToken;
  }

  async listMailboxes(_accountId: EngineAccountId): Promise<MailboxName[]> {
    throw new NotImplemented("StalwartEngine.listMailboxes");
  }

  async listMessages(_accountId: EngineAccountId, _query: MessageQuery): Promise<MessageSummary[]> {
    throw new NotImplemented("StalwartEngine.listMessages");
  }

  async getMessage(_accountId: EngineAccountId, _messageId: EngineMessageId): Promise<FullMessage | null> {
    throw new NotImplemented("StalwartEngine.getMessage");
  }

  async getThread(_accountId: EngineAccountId, _threadId: EngineThreadId): Promise<MessageSummary[]> {
    throw new NotImplemented("StalwartEngine.getThread");
  }

  async setSeen(_accountId: EngineAccountId, _messageIds: EngineMessageId[], _seen: boolean): Promise<void> {
    throw new NotImplemented("StalwartEngine.setSeen");
  }

  async setFlagged(_accountId: EngineAccountId, _messageIds: EngineMessageId[], _flagged: boolean): Promise<void> {
    throw new NotImplemented("StalwartEngine.setFlagged");
  }

  async move(_accountId: EngineAccountId, _messageIds: EngineMessageId[], _toMailbox: string): Promise<void> {
    throw new NotImplemented("StalwartEngine.move");
  }

  async saveDraft(_accountId: EngineAccountId, _input: SendDraftInput): Promise<EngineMessageId> {
    throw new NotImplemented("StalwartEngine.saveDraft");
  }

  async saveSent(_accountId: EngineAccountId, _input: SendDraftInput): Promise<SendResult> {
    throw new NotImplemented("StalwartEngine.saveSent");
  }

  async search(_accountId: EngineAccountId, _q: string, _mailbox?: string): Promise<MessageSummary[]> {
    throw new NotImplemented("StalwartEngine.search");
  }

  async status(): Promise<MailEngineStatus> {
    return { name: this.name, ok: true, detail: `JMAP endpoint configured at ${this.jmapUrl}` };
  }
}