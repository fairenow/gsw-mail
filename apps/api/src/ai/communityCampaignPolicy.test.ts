import test from "node:test";
import assert from "node:assert/strict";
import { communitySnapshotDigest,communityRecipientEligible,validCampaignSchedule,sameCampaignLaunch } from "./communityCampaignPolicy.js";
test("community campaign snapshot binds every recipient and opt-out token",()=>{
 const a={email:"a@example.com",displayName:"A",firstName:"A",communityUnsubscribeToken:"token-a"};
 const b={...a,email:"b@example.com"};
 assert.equal(communitySnapshotDigest("x","y","z",[a,b]),communitySnapshotDigest("x","y","z",[b,a]));
 assert.notEqual(communitySnapshotDigest("x","y","z",[a]),communitySnapshotDigest("x","y","z",[{...a,communityUnsubscribeToken:"token-b"}]));
});
test("missing opt-out token fails closed",async()=>assert.equal(await communityRecipientEligible({email:"a@example.com",displayName:"A",communityUnsubscribeToken:null}),false));

test("schedule accepts immediate and future dates, rejects invalid or excessively old timestamps",()=>{
 const now=1700000000000;
 assert.equal(validCampaignSchedule(now,now),true);
 assert.equal(validCampaignSchedule(now+86400000,now),true);
 assert.equal(validCampaignSchedule(now-60001,now),false);
 assert.equal(validCampaignSchedule(now+366*86400000,now),false);
 assert.equal(validCampaignSchedule(NaN,now),false);
});
test("idempotent schedule replay requires the exact time, content, client and original consent",()=>{
 const launch={userId:"user",clientId:"community",consentId:"consent",hash:"hash",scheduledAt:1700000000000};
 assert.equal(sameCampaignLaunch(launch,{...launch}),true);
 for(const changed of [{scheduledAt:launch.scheduledAt+1},{hash:"changed"},{consentId:"new-consent"},{clientId:"other"},{userId:"other"},{consentId:null}])assert.equal(sameCampaignLaunch(launch,{...launch,...changed}),false);
});
