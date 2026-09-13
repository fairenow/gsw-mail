export const FOLDERS = ["Inbox", "Sent", "Drafts", "Spam", "Trash", "Archive"] as const;
export type Folder = (typeof FOLDERS)[number];

export const FOLDER_ICON: Record<Folder, string> = {
  Inbox: "▣",
  Sent: "➤",
  Drafts: "✎",
  Spam: "!",
  Trash: "🗑",
  Archive: "🗄",
};

export const fmtTime = (value: string) => new Date(value).toLocaleString();
