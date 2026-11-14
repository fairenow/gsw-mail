import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { pool } from "../db/client.js";
import { createVideoMeeting, launchVideoMeeting, hasMeetingEntitlement, meetingConfig } from "../calendar/videoMeetings.js";

import { meetingAccountInput, createMeetingRequest, launchMeetingRequest } from "../calendar/videoMeetingRequests.js";
async function meetingAccess(userId:string,accountId:string) {
  const account=await requireAccountPermission(userId,accountId,"send");
  const result=await pool.query<{operator_exempt:boolean;status:string|null;period_end:Date|null;mailboxes:number|null;ai:number|null}>(
    "SELECT EXISTS (SELECT 1 FROM billing_mailbox_exemptions e WHERE e.organization_id=o.id) AS operator_exempt, s.status,s.current_period_end AS period_end,s.mailbox_quantity AS mailboxes,s.ai_quantity AS ai FROM organizations o LEFT JOIN billing_subscriptions s ON s.organization_id=o.id WHERE o.id=$1",[account.organizationId]);
  const row=result.rows[0];
  return {workspaceId:account.organizationId,organizerId:userId,entitled:!!row&&hasMeetingEntitlement({operatorExempt:row.operator_exempt,status:row.status,periodEnd:row.period_end,mailboxQuantity:row.mailboxes??0,aiQuantity:row.ai??0})};
}
export default async function videoMeetingRoutes(app:FastifyInstance) {
  await requireUser(app,{optional:false});
  app.get("/product/video-meetings/status",async req=>{
    const input=meetingAccountInput.strict().parse(req.query),access=await meetingAccess(req.user!.id,input.accountId);
    let configured=true;try{meetingConfig();}catch{configured=false;}
    return {available:configured&&access.entitled,reason:!configured?"not_enabled":!access.entitled?"paid_workspace_required":null,webOrigin:configured?meetingConfig().webOrigin:null};
  });
  app.post("/product/video-meetings",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async req=>{
    return createMeetingRequest(req.body,req.user!.id,meetingAccess,createVideoMeeting);
  });
  app.post("/product/video-meetings/launch",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async req=>{
    return launchMeetingRequest(req.body,req.user!.id,meetingAccess,launchVideoMeeting);
  });
}
