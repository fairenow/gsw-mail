import test from "node:test";
import assert from "node:assert/strict";
import { hasMeetingEntitlement, meetingConfig, meetingJoinUrl, meetingService } from "./videoMeetings.js";
const paid={operatorExempt:false,status:"active",periodEnd:new Date(Date.now()+86400000),mailboxQuantity:1,aiQuantity:0};
test("meetings require an active paid subscription or explicit operator exemption",()=>{
 assert.equal(hasMeetingEntitlement(paid),true);
 for(const status of ["past_due","canceled","unpaid","incomplete",null])assert.equal(hasMeetingEntitlement({...paid,status}),false);
 assert.equal(hasMeetingEntitlement({...paid,mailboxQuantity:0,aiQuantity:0}),false);
 assert.equal(hasMeetingEntitlement({...paid,periodEnd:new Date(1)}),false);
 assert.equal(hasMeetingEntitlement({...paid,status:null,periodEnd:null,operatorExempt:true}),true);
});
test("integration defaults off and rejects unsafe endpoints or unconfigured secrets",()=>{
 const env={BIBLE_MEETINGS_ENABLED:"true",BIBLE_MEETINGS_API_URL:"https://test.convex.site/integrations/gsw-mail/meetings",BIBLE_MEETINGS_WEB_ORIGIN:"https://bible.example.com",BIBLE_MEETINGS_SERVICE_SECRET:"a".repeat(40)};
 assert.equal(meetingConfig(env).webOrigin,"https://bible.example.com");
 assert.throws(()=>meetingConfig({}));
 for(const endpoint of ["http://test.convex.site/integrations/gsw-mail/meetings","https://user:password@example.com/integrations/gsw-mail/meetings","https://test.convex.site/other"]){assert.throws(()=>meetingConfig({...env,BIBLE_MEETINGS_API_URL:endpoint}))}
 assert.throws(()=>meetingConfig({...env,BIBLE_MEETINGS_SERVICE_SECRET:"short"}));
 assert.throws(()=>meetingJoinUrl("../../evil",env.BIBLE_MEETINGS_WEB_ORIGIN));
});
test("server-only service calls use HTTPS authentication and forbid redirect forwarding",async()=>{
 Object.assign(process.env,{BIBLE_MEETINGS_ENABLED:"true",BIBLE_MEETINGS_API_URL:"https://test.convex.site/integrations/gsw-mail/meetings",BIBLE_MEETINGS_WEB_ORIGIN:"https://bible.example.com",BIBLE_MEETINGS_SERVICE_SECRET:"a".repeat(40)});
 const result=await meetingService({operation:"create"},async(url,init)=>{
  assert.equal(String(url),process.env.BIBLE_MEETINGS_API_URL);assert.equal(init?.redirect,"error");
  assert.equal((init?.headers as Record<string,string>).authorization,`Bearer ${process.env.BIBLE_MEETINGS_SERVICE_SECRET}`);
  return new Response(JSON.stringify({meetingId:"meeting123"}),{status:200});
 });assert.equal(result?.meetingId,"meeting123");
 await assert.rejects(()=>meetingService({},async()=>{throw Error("secret internal infrastructure details")}),/video_meeting_service_unavailable_retry/);
});
