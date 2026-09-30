export interface OutboundAttachment {
  engineAttachmentId?: string | null | undefined;
  filename: string;
  contentType?: string | null | undefined;
  size?: number | null | undefined;
  contentDisposition?: string | null | undefined;
  contentId?: string | null | undefined;
}

export interface RelayAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  contentId?: string | undefined;
}

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
  templateKey?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  messageId?: string | undefined;
  attachments?: OutboundAttachment[] | undefined;
}

export interface RelayResult {
  accepted: boolean;
  permanent?: boolean | undefined;
  deliveryId?: string | undefined;
  message?: string | undefined;
}

export interface OutboundRelay {
  readonly name: string;
  send(job: OutboundJob, attachments?: RelayAttachment[] | undefined): Promise<RelayResult>;
}
