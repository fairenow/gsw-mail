import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { communitySendDigest, renderedMessageDigest, signCommunityReview, verifyCommunityReview } from "./communityReview.js";
const key=Buffer.alloc(32,17);
const base={userId:"u",clientId:"c",accountId:"a",senderAddress:"a@example.com",senderName:"A",to:"b@example.com",subject:"Hello",renderDigest:renderedMessageDigest({html:"<p>Hi</p>",text:"Hi",templateKey:"none"})};
test("review binds identity, account, sender, recipient, subject and rendered content",()=>{
  const digest=communitySendDigest(base),id=randomUUID();
  const token=signCommunityReview({id,digest,expiresAt:5000},key);
  assert.equal(verifyCommunityReview(token,key,digest,4000)?.id,id);
  for(const [name,value] of Object.entries(base)) {
    const modified={...base,[name]:String(value)+"x"};
    assert.equal(verifyCommunityReview(token,key,communitySendDigest(modified),4000),null);
  }
  assert.equal(verifyCommunityReview(token,key,digest,5000),null);
  assert.equal(verifyCommunityReview(token,Buffer.alloc(32,18),digest,4000),null);
  assert.equal(verifyCommunityReview(token+"x",key,digest,4000),null);
});
test("render changes invalidate review",()=>{
  assert.notEqual(renderedMessageDigest({html:"<p>Hi</p>",text:"Hi",templateKey:"none"}),renderedMessageDigest({html:"<p>Bye</p>",text:"Hi",templateKey:"none"}));
});
