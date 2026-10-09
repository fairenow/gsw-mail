import test from "node:test";
import assert from "node:assert/strict";
import { calendarTools } from "./calendarTools.js";
import { selectAgentSkills, skillToolMatch } from "../skills.js";
import { isAiScopeGloballyEnabled, defaultAiCapabilities } from "../capabilities.js";

test("meeting requests select calendar tools", () => {
  const skills = selectAgentSkills("Find my calendar events and meetings tomorrow");
  assert.ok(skills.some(skill => skill.id === "calendar_management"));
  assert.ok(skills.some(skill => skillToolMatch(skill, "calendar.events.list")));
});
test("calendar write operations require confirmation and write permission", () => {
  for (const name of ["calendar.events.create", "calendar.events.update", "calendar.events.delete"]) {
    const tool = calendarTools.find(item => item.name === name);
    assert.ok(tool);
    assert.equal(tool.risk, "external");
    assert.deepEqual(tool.requiredScopes, ["calendar.write"]);
  }
  assert.equal(isAiScopeGloballyEnabled({ ...defaultAiCapabilities, draftMutation: false }, "calendar.write"), false);
});
test("calendar discovery is read-only", () => {
  for (const name of ["calendar.list", "calendar.events.list"]) {
    const tool = calendarTools.find(item => item.name === name);
    assert.ok(tool);
    assert.equal(tool.risk, "read");
    assert.deepEqual(tool.requiredScopes, ["calendar.read"]);
  }
});
