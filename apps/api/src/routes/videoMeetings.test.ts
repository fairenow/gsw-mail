import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingRequest, launchMeetingRequest } from "../calendar/videoMeetingRequests.js";
const createInput={accountId:"mailbox-a",externalEventId:"e4efebc0-a80b-4ecd-b051-46b036e466ea",title:"Team planning"};
test("uses authenticated product identity and mailbox workspace for creation",async()=>{
 const calls:unknown[]=[];
 const result=await createMeetingRequest(createInput,"mail-user",async(userId,accountId)=>{calls.push({userId,accountId});return {workspaceId:"trusted-workspace",organizerId:userId,entitled:true}},async input=>{calls.push(input);return {meetingId:"room",joinUrl:"https://bible.example.com/meet/room"}});
 assert.equal(result.meetingId,"room");assert.deepEqual(calls,[{userId:"mail-user",accountId:"mailbox-a"},{workspaceId:"trusted-workspace",organizerId:"mail-user",externalEventId:createInput.externalEventId,title:createInput.title}]);
});
test("rejects client-supplied workspace, organizer and broadcast capabilities before authorization",async()=>{
 for(const extra of [{workspaceId:"victim"},{organizerId:"victim"},{publicLink:true}])await assert.rejects(()=>createMeetingRequest({...createInput,...extra},"mail-user",async()=>{throw Error("authorization should not be called")},async()=>({meetingId:"room",joinUrl:"url"})),error=>!String(error).includes("authorization should not"));
});
test("free workspaces and unauthorized mailboxes cannot create or launch meetings",async()=>{
 for(const entitled of [false,true]){
  const access=async()=>{if(entitled)throw Error("mailbox_forbidden");return {workspaceId:"workspace",organizerId:"user",entitled:false}};
  await assert.rejects(()=>createMeetingRequest(createInput,"user",access,async()=>{throw Error("must_not_create")}),/paid_workspace_required|mailbox_forbidden/);
  await assert.rejects(()=>launchMeetingRequest({accountId:"mailbox-a",meetingId:"room"},"user",access,async()=>{throw Error("must_not_launch")}),/paid_workspace_required|mailbox_forbidden/);
 }
});
