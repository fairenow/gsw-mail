import { z } from "zod";
import { HttpError } from "../lib/errors.js";
import type { createVideoMeeting, launchVideoMeeting } from "./videoMeetings.js";
export const meetingAccountInput=z.object({accountId:z.string().min(1).max(200)});
type Access=(userId:string,accountId:string)=>Promise<{workspaceId:string;organizerId:string;entitled:boolean}>;
export async function createMeetingRequest(body:unknown,userId:string,access:Access,create:typeof createVideoMeeting) {
  const input=meetingAccountInput.extend({externalEventId:z.string().uuid(),title:z.string().trim().min(3).max(160),scheduledAt:z.number().finite().optional()}).strict().parse(body);
  const identity=await access(userId,input.accountId);
  if(!identity.entitled)throw new HttpError(403,"paid_workspace_required_for_video_meetings");
  return create({workspaceId:identity.workspaceId,organizerId:identity.organizerId,externalEventId:input.externalEventId,title:input.title,...(input.scheduledAt!==undefined?{scheduledAt:input.scheduledAt}:{})});
}
export async function launchMeetingRequest(body:unknown,userId:string,access:Access,launch:typeof launchVideoMeeting) {
  const input=meetingAccountInput.extend({meetingId:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/)}).strict().parse(body);
  const identity=await access(userId,input.accountId);
  if(!identity.entitled)throw new HttpError(403,"paid_workspace_required_for_video_meetings");
  return launch({workspaceId:identity.workspaceId,organizerId:identity.organizerId,meetingId:input.meetingId});
}
