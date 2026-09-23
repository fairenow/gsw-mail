import type { ComposeAttachment } from "../api";

export type DraftAttachmentMeta = {
  position: number;
  filename: string;
  contentType: string;
  size: number;
  contentDisposition?: string;
  contentId?: string;
};

const parse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? `draft attachment request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const path = (draftId: string) => `/mail/drafts/${encodeURIComponent(draftId)}/attachments`;

export async function listDraftAttachments(accountId: string, draftId: string): Promise<DraftAttachmentMeta[]> {
  const response = await fetch(`${path(draftId)}?accountId=${encodeURIComponent(accountId)}`, { credentials: "include" });
  return parse<{ attachments: DraftAttachmentMeta[] }>(response).then((result) => result.attachments);
}

export async function appendDraftAttachments(accountId: string, draftId: string, attachments: ComposeAttachment[]): Promise<DraftAttachmentMeta[]> {
  const response = await fetch(path(draftId), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, attachments }),
  });
  return parse<{ attachments: DraftAttachmentMeta[] }>(response).then((result) => result.attachments);
}

export async function removeDraftAttachment(accountId: string, draftId: string, position: number): Promise<DraftAttachmentMeta[]> {
  const response = await fetch(`${path(draftId)}/${position}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parse<{ attachments: DraftAttachmentMeta[] }>(response).then((result) => result.attachments);
}
