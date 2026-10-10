import { useEffect, useMemo, useState } from "react";
import { api, type CampaignReview, type Contact, type FileNode } from "../api";
import { useAppShell } from "../components/AppShell";
import "../styles/campaignReview.css";

export function CampaignReviewPage() {
  const { account } = useAppShell();
  const id = window.location.pathname.match(/^\/campaigns\/([0-9a-f-]{36})$/i)?.[1] ?? "";
  const [review,setReview] = useState<CampaignReview|null>(null);
  const [contacts,setContacts] = useState<Contact[]>([]);
  const [files,setFiles] = useState<FileNode[]>([]);
  const [query,setQuery] = useState("");
  const [selected,setSelected] = useState<string[]>([]);
  const [attachmentIds,setAttachmentIds] = useState<string[]>([]);
  const [subject,setSubject] = useState("");
  const [textBody,setTextBody] = useState("");
  const [htmlBody,setHtmlBody] = useState("");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");

  const refresh = async () => {
    if (!account || !id) return;
    const data=await api.campaignReview(id,account.id);
    setReview(data);
    setSelected(data.recipients.flatMap(item=>item.contactId?[item.contactId]:[]));
    setAttachmentIds(data.campaign.attachmentAssetIds ?? []);
    setSubject(data.campaign.subject);
    setTextBody(data.campaign.textBody);
    setHtmlBody(data.campaign.htmlBody);
  };
  useEffect(()=>{
    if(!account||!id)return;
    let cancelled=false;
    void Promise.all([api.campaignReview(id,account.id),api.files(undefined,"recent")]).then(([data,assets])=>{
      if(cancelled)return;
      setReview(data);
      setFiles(assets.filter(node=>node.nodeType==="file"&&node.assetId&&node.status==="ready"));
      setSelected(data.recipients.flatMap(item=>item.contactId?[item.contactId]:[]));
      setAttachmentIds(data.campaign.attachmentAssetIds??[]);
      setSubject(data.campaign.subject);setTextBody(data.campaign.textBody);setHtmlBody(data.campaign.htmlBody);
    }).catch(()=>{if(!cancelled)setError("Couldn't load this campaign review.");});
    return ()=>{cancelled=true;};
  },[account?.id,id]);

  useEffect(()=>{
    let cancelled=false;
    void api.contactsPage(query,50,0).then(data=>{if(!cancelled)setContacts(data.contacts);}).catch(()=>{if(!cancelled)setContacts([]);});
    return ()=>{cancelled=true;};
  },[query]);
  const canEdit = review?.campaign.status==="draft" && account?.permissions.includes("send");
  const recipientEmails = useMemo(()=>new Set(review?.recipients.map(item=>item.email.toLowerCase())??[]),[review]);
  const selectedFiles=files.filter(item=>item.assetId&&attachmentIds.includes(item.assetId));
  const toggleContact = (contactId:string) => setSelected(current=>current.includes(contactId)?current.filter(id=>id!==contactId):[...current,contactId].slice(0,100));
  const toggleFile=(assetId:string)=>setAttachmentIds(current=>current.includes(assetId)?current.filter(id=>id!==assetId):[...current,assetId].slice(0,5));
  async function save(which:"audience"|"draft") {
    if(!account||!id||!canEdit)return;
    setBusy(true);setError("");setNotice("");
    try {
      if(which==="audience") {
        if(!selected.length) {setError("Select at least one contact.");return;}
        await api.campaignAudienceEdit(id,account.id,selected);
      } else {
        await api.campaignDraftEdit(id,{accountId:account.id,subject,textBody,htmlBody,attachmentAssetIds:attachmentIds});
      }
      await refresh();
      setNotice("Draft updated. No emails have been sent.");
    }catch{setError("Couldn't save the campaign changes. Please retry.");}
    finally{setBusy(false);}
  }

  if(!account)return <div className="gsw-campaign-review"><h1>Campaign review</h1><p>Select a mailbox to review this campaign.</p></div>;
  if(!id)return <div className="gsw-campaign-review"><h1>Campaign not found</h1></div>;
  return <main className="gsw-campaign-review">
    <header><a href="/chat">← GSW Chat</a><span>Campaign review</span></header>
    <div className="gsw-campaign-hero">
      <h1>{review?.campaign.title??"Loading campaign…"}</h1>
      <p>Review the saved recipient list, draft content, and files before you ask GSW Chat to launch this campaign. Nothing on this page sends email.</p>
      {review&&<div><strong>{review.campaign.recipientCount}</strong> saved recipients · <strong>{review.campaign.status}</strong></div>}
    </div>
    {error&&<p className="gsw-campaign-notice error" role="alert">{error}</p>}
    {notice&&<p className="gsw-campaign-notice" role="status">{notice}</p>}
    {!review? <p>Loading campaign…</p>:<>
      <section className="gsw-campaign-card">
        <h2>1. Audience</h2>
        <p>The saved recipient snapshot is used at launch. Search your existing contacts to include or exclude people.</p>
        <label>Search contacts <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name, company or email" /></label>
        <div className="gsw-campaign-contacts">
          {contacts.map(contact=><label key={contact.id}><input type="checkbox" disabled={!canEdit||busy} checked={selected.includes(contact.id)} onChange={()=>toggleContact(contact.id)}/><span>{contact.displayName||contact.firstName||contact.emails[0]?.email||"Unnamed contact"}<small>{contact.emails.find(email=>email.isPrimary)?.email??contact.emails[0]?.email??"No email"}</small></span></label>)}
        </div>
        <p>{selected.length} contacts selected{review.recipients.some(r=>!r.contactId)?" · Some previous recipients have no linked contact and may be removed when saving.":""}</p>
        <button disabled={!canEdit||busy||selected.length===0} onClick={()=>void save("audience")}>Save recipient selection</button>
      </section>
      <section className="gsw-campaign-card">
        <h2>2. Personalized campaign</h2>
        <p>Use <code>{"{{firstName}}"}</code> and <code>{"{{email}}"}</code> for individual personalization.</p>
        <label>Subject<input disabled={!canEdit||busy} value={subject} onChange={event=>setSubject(event.target.value)}/></label>
        <label>Plain-text body<textarea disabled={!canEdit||busy} rows={7} value={textBody} onChange={event=>setTextBody(event.target.value)}/></label>
        <label>Optional HTML body (source)<textarea disabled={!canEdit||busy} rows={4} value={htmlBody} onChange={event=>setHtmlBody(event.target.value)}/></label>
        <h3>GSW Files attachments</h3>
        <p>Choose up to five existing files (20 MB combined). Attachments are verified on save and again when sending.</p>
        <div className="gsw-campaign-contacts">
          {files.slice(0,100).map(file=>file.assetId&&<label key={file.id}><input type="checkbox" disabled={!canEdit||busy||(!attachmentIds.includes(file.assetId)&&attachmentIds.length>=5)} checked={attachmentIds.includes(file.assetId)} onChange={()=>toggleFile(file.assetId!)}/><span>{file.name}<small>{file.mimeType??"File"} · {Math.round((file.sizeBytes??0)/1024)} KB</small></span></label>)}
        </div>
        <p>{selectedFiles.length} visible files selected; {attachmentIds.length} attachments in the draft.</p>
        <button disabled={!canEdit||busy||!subject.trim()} onClick={()=>void save("draft")}>Save message and attachments</button>
      </section>
      <section className="gsw-campaign-card">
        <h2>3. Saved recipient previews</h2>
        <p>These previews reflect the saved draft, not unsaved edits above. HTML is not executed in the reviewer.</p>
        <div className="gsw-campaign-previews">
          {review.recipients.map(recipient=><article key={recipient.id}>
            <strong>{recipient.displayName||recipient.email}</strong><small>{recipient.email}{recipientEmails.has(recipient.email.toLowerCase())?"":""}</small>
            <p><b>Subject:</b> {recipient.subject}</p><pre>{recipient.textBody||"HTML-only campaign (review source above)"}</pre>
          </article>)}
        </div>
      </section>
      <section className="gsw-campaign-card">
        <h2>4. Approval and launch</h2>
        <p>Returning to GSW Chat does not send the campaign. GSW must still request your explicit confirmation before launch.</p>
        <button onClick={()=>void navigator.clipboard.writeText(`Review and launch campaign ${id} for mailbox ${account.id} with reviewed snapshot hash ${review.campaign.reviewHash}. Show the saved recipient count and attachments, then ask for my explicit confirmation before sending.`)}>Copy launch request</button>
        <a className="gsw-campaign-link" href="/chat">Return to GSW Chat</a>
      </section>
    </>}
  </main>;
}
