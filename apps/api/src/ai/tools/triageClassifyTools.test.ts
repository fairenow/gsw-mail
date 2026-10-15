import assert from "node:assert/strict";
import test from "node:test";
import { extractTriageJson, validateTriageVerdict } from "./triageClassifyTools.js";

const example={
  category:"needs_reply",priority:"high",summary:"The customer requested a revised quote. They need confirmation by Friday.",
  reason:"The most recent email includes a direct question.",evidenceMessageIds:["m1"],confidence:"high",
};
test("classifications must cite messages in the retrieved thread",()=>{
  assert.equal(validateTriageVerdict(example,["m1"],true).category,"needs_reply");
  assert.throws(()=>validateTriageVerdict({...example,evidenceMessageIds:["fake"]},["m1"],true),/unavailable evidence/);
});
test("truncated threads cannot claim high confidence",()=>{
  assert.throws(()=>validateTriageVerdict(example,["m1"],false),/truncated thread/);
  assert.equal(validateTriageVerdict({...example,confidence:"low"},["m1"],false).confidence,"low");
});
test("model output parsing supports JSON fences without executing untrusted text",()=>{
  assert.equal((extractTriageJson("\`\`\`json\n"+JSON.stringify(example)+"\n\`\`\`") as {category:string}).category,"needs_reply");
  assert.throws(()=>extractTriageJson("This email definitely needs a reply."),SyntaxError);
});
