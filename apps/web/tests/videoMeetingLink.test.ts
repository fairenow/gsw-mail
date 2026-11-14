import test from "node:test";
import assert from "node:assert/strict";
import { videoMeetingId } from "../src/lib/videoMeetingLink.js";
test("only exact partner meeting URLs trigger an organizer handoff",()=>{
 const origin="https://bible.guidedstepswellness.com";
 assert.equal(videoMeetingId(`${origin}/meet/meeting123`,origin),"meeting123");
 for(const link of [`${origin}.evil.com/meet/id`,`http://bible.guidedstepswellness.com/meet/id`,`${origin}/live/id`,`${origin}/meet/id#host=secret`,`${origin}/meet/id?redirect=evil`])assert.equal(videoMeetingId(link,origin),null);
 assert.equal(videoMeetingId(`${origin}/meet/meeting123`,null),null);
});
import { organizerLaunchUrl } from "../src/lib/videoMeetingLink.js";
test("organizer redirects require the configured origin, meeting and single-use fragment",()=>{
 const origin="https://bible.example.com",valid=`${origin}/meet/id#host=${"a".repeat(64)}`;
 assert.equal(organizerLaunchUrl(valid,origin,"id"),valid);
 for(const url of [valid.replace("/id#","/other#"),valid.replace("https://bible.example.com","https://evil.example.com"),`${origin}/meet/id?redirect=evil#host=${"a".repeat(64)}`,`${origin}/meet/id#host=short`])assert.equal(organizerLaunchUrl(url,origin,"id"),null);
});
