import { createBookingDecisionToken } from "./decisionToken.js";
import type { BookingRow, EventLinkRow } from "./service.js";
const origin = "https://mail.guidedstepswellness.com";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function bookingNotice(
  link: EventLinkRow,
  b: BookingRow,
  stage: string,
  organizer: string,
  owner: boolean,
) {
  const title =
    (
      {
        pending: "Booking request received",
        confirmed: "Booking confirmed",
        declined: "Booking declined",
        expired: "Booking request expired",
        attention: "Booking needs attention",
      } as Record<string, string>
    )[stage] ?? "Booking update";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: b.settings.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(b.starts_at);
  const expires = new Intl.DateTimeFormat("en-US", {
    timeZone: b.settings.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(b.hold_until);
  const status =
    stage === "pending"
      ? owner
        ? `Please approve or decline this request before ${expires} (${b.settings.timeZone}). The time is held until then.`
        : "Your request is awaiting organizer approval. This time is held for up to 24 hours; it is not confirmed yet."
      : stage === "confirmed"
        ? "Your booking is confirmed and has been added to the organizer’s calendar."
        : stage === "attention"
          ? "Calendar creation could not be verified. Check your calendar before declining this request."
          : stage === "expired"
            ? "This request expired before it was approved. Please choose another time."
            : "This request was declined. Please choose another time.";
  const details: [string, string][] = [
    ["When", `${time} (${b.settings.timeZone})`],
    [
      "Duration",
      `${(b.ends_at.getTime() - b.starts_at.getTime()) / 60000} minutes`,
    ],
    ["Organizer", organizer],
    ["Guest", b.name],
    ["Email", b.email],
  ];
  if (b.settings.location) details.push(["Location", b.settings.location]);
  if (owner)
    details.push(
      ["Phone", b.phone || "Not provided"],
      ["Message", b.message || "Not provided"],
    );
  const actions: [string, string][] = [];
  if (
    owner &&
    ["pending", "attention"].includes(stage) &&
    ["pending", "attention"].includes(b.status) &&
    b.hold_until.getTime() > Date.now()
  ) {
    const token = createBookingDecisionToken({
      id: b.id,
      accountId: b.account_id,
      userId: link.user_id,
      exp: b.hold_until.getTime(),
    });
    const url = `${origin}/booking/decision#token=${encodeURIComponent(token)}`;
    if (stage === "pending")
      actions.push(["Approve booking", `${url}&choice=approve`]);
    actions.push(["Decline booking", `${url}&choice=decline`]);
  }
  const meeting =
    stage === "confirmed" ? b.meeting_url || b.settings.meetingUrl : "";
  if (meeting && /^https:\/\//i.test(meeting))
    actions.push(["Join meeting", meeting]);
  actions.push(
    owner
      ? ["Open calendar", `${origin}/calendar`]
      : ["Booking page", `${origin}/book/${link.slug}`],
  );
  const text = `${title}\n\n${b.settings.name}\n\n${status}\n\n${details.map(([label, value]) => `${label}: ${value}`).join("\n\n")}\n\n${actions.map(([label, url]) => `${label}:\n${url}`).join("\n\n")}\n\n${owner && stage === "pending" ? "Approval links are private. A confirmation click is required; opening an email link does not change a booking." : "Sent by GSW Mail."}`;
  const html = `<div style="margin:0;background:#f7f3ea;color:#2f2f2f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e8e1d4;border-radius:16px"><tr><td style="padding:28px"><p style="color:#956000;font-size:13px;font-weight:bold;letter-spacing:2px">GSW MAIL · EVENT LINK</p><h1 style="font-size:26px;line-height:1.3;margin:20px 0 8px">${escape(title)}</h1><h2 style="font-size:20px;margin:0 0 20px">${escape(b.settings.name)}</h2><p style="font-size:16px;line-height:1.6">${escape(status)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${details.map(([label, value]) => `<tr><td style="padding:12px 0;border-bottom:1px solid #eee"><strong style="font-size:13px;color:#706b61">${escape(label)}</strong><div style="font-size:16px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${escape(value)}</div></td></tr>`).join("")}</table><div style="padding-top:22px">${actions.map(([label, url]) => `<p style="margin:0 0 12px"><a href="${escape(url)}" style="display:inline-block;background:${label === "Decline booking" ? "#ece8df" : "#995d00"};color:${label === "Decline booking" ? "#2f2f2f" : "#fff"};padding:14px 22px;border-radius:8px;font-size:16px;font-weight:bold;text-decoration:none">${escape(label)}</a></p>`).join("")}</div><p style="font-size:13px;line-height:1.6;color:#706b61">${owner && stage === "pending" ? "Keep approval links private. Confirm your choice on the page that opens. Email security scans cannot approve or decline a booking." : "Sent by GSW Mail. Reply to this email to contact the organizer."}</p></td></tr></table></td></tr></table></div>`;
  return { subject: `${title}: ${b.settings.name}`, text, html };
}
