import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../lib/errors.js";

export interface MeetingBillingState { operatorExempt: boolean; status: string | null; periodEnd: Date | string | null; mailboxQuantity: number; aiQuantity: number; }
export function hasMeetingEntitlement(state: MeetingBillingState, now = Date.now()): boolean {
  if (state.operatorExempt) return true;
  return ["active", "trialing"].includes(state.status ?? "") && !!state.periodEnd && new Date(state.periodEnd).getTime() > now && (state.mailboxQuantity > 0 || state.aiQuantity > 0);
}
export function meetingConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.BIBLE_MEETINGS_ENABLED !== "true") throw new HttpError(503,"video_meetings_not_enabled");
  const endpoint = new URL(env.BIBLE_MEETINGS_API_URL ?? "https://unconfigured.invalid");
  const web = new URL(env.BIBLE_MEETINGS_WEB_ORIGIN ?? "https://unconfigured.invalid");
  const secret = env.BIBLE_MEETINGS_SERVICE_SECRET;
  if (!secret || secret.length < 32 || endpoint.hostname === "unconfigured.invalid" || web.hostname === "unconfigured.invalid" || endpoint.protocol !== "https:" || web.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/integrations/gsw-mail/meetings" || web.username || web.password || web.search || web.hash || web.pathname !== "/") throw new HttpError(503,"video_meetings_not_configured");
  return { endpoint:endpoint.href, webOrigin:web.origin, secret };
}
export function meetingJoinUrl(id: string, origin: string) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new HttpError(502,"invalid_meeting_response");
  return new URL(`/meet/${encodeURIComponent(id)}`,origin).href;
}
export async function meetingService(body: Record<string, unknown>, request: typeof fetch = fetch) {
  const config = meetingConfig();
  let response: Response;
  try { response = await request(config.endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${config.secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:"error"}); }
  catch { throw new HttpError(502,"video_meeting_service_unavailable_retry"); }
  const value = await response.json().catch(()=>null) as {meetingId?:unknown;error?:unknown}|null;
  if (!response.ok) {
    const allowed = ["MEETING_ACCESS_DENIED","MEETING_ENDED","MEETING_CANCELED","MEETING_ENTITLEMENT_REQUIRED"];
    const code = typeof value?.error === "string" && allowed.includes(value.error) ? value.error.toLowerCase() : "video_meeting_service_unavailable_retry";
    throw new HttpError(response.status === 403 ? 403 : 502,code);
  }
  return value;
}
export async function createVideoMeeting(input: {workspaceId:string;organizerId:string;externalEventId:string;title:string;scheduledAt?:number}) {
  const value=await meetingService({operation:"create",...input,entitlementUntil:Date.now()+300000});
  if(typeof value?.meetingId!=="string")throw new HttpError(502,"invalid_meeting_response");
  return {meetingId:value.meetingId,joinUrl:meetingJoinUrl(value.meetingId,meetingConfig().webOrigin)};
}
export async function launchVideoMeeting(input: {workspaceId:string;organizerId:string;meetingId:string}) {
  const ticket=randomBytes(32).toString("hex"),ticketHash=createHash("sha256").update(ticket).digest("hex");
  await meetingService({operation:"launch",...input,ticketHash,entitlementUntil:Date.now()+300000});
  return {url:`${meetingJoinUrl(input.meetingId,meetingConfig().webOrigin)}#host=${ticket}`};
}
