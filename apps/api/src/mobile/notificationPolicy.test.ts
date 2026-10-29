import assert from "node:assert/strict";
import test from "node:test";
import { calendarStartInstant, pushCategoryEnabled, type PushPreferences } from "./notificationPolicy.js";
const preferences:PushPreferences={mailEnabled:false,calendarEnabled:true,chatEnabled:false,scheduledWorkEnabled:true,workAttentionEnabled:false,calendarReminderMinutes:15};
test("each push category independently honors its preference",()=>{
  for(const [category,expected] of [["mail",false],["calendar",true],["chat",false],["scheduledWork",true],["workAttention",false],["general",true]] as const) assert.equal(pushCategoryEnabled(preferences,category),expected);
});
test("calendar reminder instants preserve local time across daylight-saving changes",()=>{
  assert.equal(calendarStartInstant("2026-10-29T09:00:00","America/Detroit").toISOString(),"2026-10-29T13:00:00.000Z");
  assert.equal(calendarStartInstant("2026-11-02T09:00:00","America/Detroit").toISOString(),"2026-11-02T14:00:00.000Z");
  assert.equal(calendarStartInstant("2026-10-29T09:00:00-04:00","UTC").toISOString(),"2026-10-29T13:00:00.000Z");
  assert.equal(calendarStartInstant("2026-10-29T09:00:00.000","America/Detroit").toISOString(),"2026-10-29T13:00:00.000Z");
  assert.throws(()=>calendarStartInstant("2026-03-08T02:30:00","America/Detroit"));
  assert.throws(()=>calendarStartInstant("invalid"));
});
