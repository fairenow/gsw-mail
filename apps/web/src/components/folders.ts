import type { LucideIcon } from "lucide-react";
import { Archive, Clock3, FileText, Inbox, Send, Trash2, TriangleAlert } from "lucide-react";

export const FOLDERS = ["Inbox", "Sent", "Drafts", "Outbox", "Spam", "Trash", "Archive"] as const;
export type Folder = (typeof FOLDERS)[number];

export const FOLDER_ICON: Record<Folder, LucideIcon> = {
  Inbox,
  Sent: Send,
  Drafts: FileText,
  Outbox: Clock3,
  Spam: TriangleAlert,
  Trash: Trash2,
  Archive,
};

export const fmtTime = (value: string) => new Date(value).toLocaleString();
