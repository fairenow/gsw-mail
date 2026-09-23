import { plainTextToHtml, sanitizeHtml } from "../../lib/richText";
import { api, type Contact, type FullMessage } from "../../api";
import { Archive, ArrowLeft, Copy, Download, Ellipsis, Forward, Mail, Paperclip, Reply, RotateCcw, Star, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import type { Folder } from "../folders";
import { SenderAvatar } from "./SenderAvatar";

const fmtDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export function MessageReader({ message, accountId, accountAddress, folder, onBack, onReply, onReplyAll, onForward, onArchive, onTrash, onToggleRead, onToggleFlag, onRestore, onDestroy, onComposeEmail }: {
  message: FullMessage;
  accountId?: string;
  accountAddress?: string;
  folder: Folder;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleRead: () => void;
  onToggleFlag?: () => void;
  onRestore: () => void;
  onDestroy: () => void;
  onComposeEmail: (email: string) => void;
}) {
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const body = sanitizeHtml(message.htmlBody?.trim() || plainTextToHtml(message.textBody?.trim() || ""));
  const recipientLabel = message.to?.map((recipient) => recipient.name || recipient.email).join(", ") || accountAddress || "your mailbox";

  return (
    <article className="gsw-reading-inner">
      <button className="gsw-reader-back" onClick={onBack}><ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" /> Back to messages</button>
      <h2 className="gsw-reading-subject">{message.subject || "(no subject)"}</h2>
      <div className="gsw-reading-from"><SenderAvatar size="large" name={message.from?.name} email={message.from?.email} /><div><strong>{message.from?.name || message.from?.email || "Unknown sender"}</strong>{message.from?.email && <button className="gsw-address-button" onClick={() => setSelectedEmail(message.from!.email)}>{message.from.email}</button>}</div><time className="gsw-reading-time" dateTime={message.date}>{fmtDate(message.date)}</time></div>
      <p className="gsw-reading-recipient">To {message.to?.map((recipient) => <span key={recipient.email}> <button className="gsw-address-button" onClick={() => setSelectedEmail(recipient.email)}>{recipient.name || recipient.email}</button></span>) || recipientLabel}</p>
      <div className="gsw-toolbar" aria-label="Message actions">{folder === "Trash" ? <><button onClick={onRestore}><RotateCcw size={16} /><span>Restore</span></button><button className="gsw-danger-action" onClick={onDestroy}><Trash2 size={16} /><span>Delete forever</span></button></> : folder === "Sent" ? <><button onClick={onForward}><Forward size={16} /><span>Forward</span></button><button onClick={onArchive}><Archive size={16} /><span>Archive</span></button><button onClick={onTrash}><Trash2 size={16} /><span>Delete</span></button></> : folder === "Spam" ? <><button onClick={onRestore}><RotateCcw size={16} /><span>Not spam</span></button><button onClick={onTrash}><Trash2 size={16} /><span>Delete</span></button></> : <><button onClick={onReply}><Reply size={16} /><span>Reply</span></button><button onClick={onReplyAll}><Reply size={16} /><span>Reply all</span></button><button onClick={onForward}><Forward size={16} /><span>Forward</span></button><button onClick={onArchive}><Archive size={16} /><span>Archive</span></button><button onClick={onTrash}><Trash2 size={16} /><span>{folder === "Archive" ? "Move to Trash" : "Delete"}</span></button><button onClick={onToggleRead}><Mail size={16} /><span>{message.read ? "Mark unread" : "Mark read"}</span></button></>}{onToggleFlag && <button onClick={onToggleFlag} aria-label={message.flagged ? "Unstar message" : "Star message"}><Star size={17} fill={message.flagged ? "currentColor" : "none"} /><span>{message.flagged ? "Unstar" : "Star"}</span></button>}<button aria-label="More message actions"><Ellipsis size={18} /></button></div>
      {body ? <div className="gsw-reading-body" dangerouslySetInnerHTML={{ __html: body }} /> : <div className="gsw-reading-body"><span className="gsw-body-empty">This message has no readable body.</span></div>}
      {!!message.attachments?.length && <div className="gsw-attachments"><h3>Attachments ({message.attachments.length})</h3>{message.attachments.filter((attachment) => !attachment.inline).map((attachment) => <div className="gsw-attachment" key={attachment.engineId}><span className="gsw-att-icon" aria-hidden="true"><Paperclip size={18} strokeWidth={1.75} /></span><div><strong>{attachment.filename}</strong><span>{formatBytes(attachment.size)} · {attachment.contentType}</span></div>{accountId ? <a className="gsw-attachment-action" href={api.attachmentUrl(accountId, attachment)} download={attachment.filename}><Download size={15} /> Download</a> : <span className="gsw-attachment-action">Download unavailable</span>}</div>)}</div>}
      <div className="gsw-reader-bottom-actions"><button className="gsw-secondary-btn" onClick={onReply}><Reply size={16} /> Reply</button><button className="gsw-secondary-btn" onClick={onForward}><Forward size={16} /> Forward</button></div>
      {selectedEmail && <EmailActionModal email={selectedEmail} onClose={() => setSelectedEmail(null)} onCompose={() => { setSelectedEmail(null); onComposeEmail(selectedEmail); }} />}
    </article>
  );
}

function EmailActionModal({ email, onClose, onCompose }: { email: string; onClose: () => void; onCompose: () => void }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const loadContact = async () => { setLoading(true); try { setContact((await api.contacts(email))[0] ?? null); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setLoading(false); } };
  const addContact = async () => { try { const created = await api.createContact({ displayName: email, emails: [{ email }] }); setContact(created); setNotice("Added to contacts"); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } };
  const copy = async () => { await navigator.clipboard.writeText(email); setNotice("Email copied"); };
  return <div className="gsw-modal-backdrop" onClick={onClose}><section className="gsw-email-action-modal" onClick={(event) => event.stopPropagation()}><button className="gsw-drawer-close" onClick={onClose} aria-label="Close email actions">×</button><p className="gsw-eyebrow">Email address</p><h2>{contact?.displayName || email}</h2><p>{email}</p><div className="gsw-email-action-list"><button onClick={loadContact}>{loading ? "Loading..." : "View contact details"}</button><button onClick={onCompose}>Send email</button><button onClick={contact ? undefined : addContact} disabled={Boolean(contact)}><UserPlus size={16} />{contact ? "Already in contacts" : "Add to contacts"}</button><button onClick={() => void copy()}><Copy size={16} />Copy email</button></div>{contact && <div className="gsw-email-contact-details"><strong>{contact.displayName || email}</strong>{contact.organization && <span>{contact.organization}</span>}{contact.jobTitle && <span>{contact.jobTitle}</span>}{contact.notes && <p>{contact.notes}</p>}</div>}{notice && <p className="gsw-save-notice">{notice}</p>}</section></div>;
}

const formatBytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
