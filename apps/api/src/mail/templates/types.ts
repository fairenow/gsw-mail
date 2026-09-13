export interface MailTemplateInput {
  bodyHtml?: string | undefined;
  bodyText?: string | undefined;
  communityName?: string | undefined;
  ctaLabel?: string | undefined;
  ctaUrl?: string | undefined;
  lessonTitle?: string | undefined;
  recipientName?: string | undefined;
  scriptureReference?: string | undefined;
  scriptureText?: string | undefined;
  senderName?: string | undefined;
  senderTitle?: string | undefined;
  senderEmail?: string | undefined;
}

export interface RenderedMailTemplate {
  html: string;
  text: string;
}

export interface MailTemplate {
  key: string;
  name: string;
  category?: string | undefined;
  defaultSubject?: string | undefined;
  description?: string | undefined;
  availableVariables?: string[] | undefined;
  render: (input: MailTemplateInput) => RenderedMailTemplate;
}
