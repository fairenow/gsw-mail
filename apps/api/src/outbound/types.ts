export interface OutboundJob {
  id: string;
  accountId: string;
  fromAddress: string;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}

export interface RelayResult {
  accepted: boolean;
  permanent?: boolean | undefined;
  deliveryId?: string | undefined;
  message?: string | undefined;
}

export interface OutboundRelay {
  readonly name: string;
  send(job: OutboundJob): Promise<RelayResult>;
}