import type { LucideIcon } from "lucide-react";
import { Archive, FileText, Inbox, Send, Trash2, TriangleAlert } from "lucide-react";

export const FOLDERS = ["Inbox", "Sent", "Drafts", "Spam", "Trash", "Archive"] as const;
export type Folder = (typeof FOLDERS)[number];

export const FOLDER_ICON: Record<Folder, LucideIcon> = {
  Inbox,
  Sent: Send,
  Drafts: FileText,
  Spam: TriangleAlert,
  Trash: Trash2,
  Archive,
};

export const fmtTime = (value: string) => new Date(value).toLocaleString();
