import test from "node:test";
import assert from "node:assert/strict";
import {followupSchema} from "./communityFollowups.js";
const options=[{label:"2025",value:"Use the 2025 event"},{label:"2026",value:"Use the 2026 event"}];
test("radio choices must be distinct and genuinely multiple",()=>{
 assert.equal(followupSchema.safeParse({kind:"radio",question:"Which event?",options}).success,true);
 assert.equal(followupSchema.safeParse({kind:"radio",question:"Which event?",options:[options[0]]}).success,false);
 assert.equal(followupSchema.safeParse({kind:"radio",question:"Which event?",options:[options[0],options[0]]}).success,false);
});
test("single suggested action is allowed; executable properties are not",()=>{
 assert.equal(followupSchema.safeParse({kind:"actions",question:"Next step?",options:[options[0]]}).success,true);
 assert.equal(followupSchema.safeParse({kind:"actions",question:"Next step?",options:[{...options[0],url:"https://example.com"}]}).success,false);
});
test("form fields are bounded and validate choice fields and unique keys",()=>{
 const field={key:"event",label:"Event",type:"radio",options,required:true};
 assert.equal(followupSchema.safeParse({kind:"form",question:"Details?",fields:[field,{key:"date",label:"Date",type:"date"}]}).success,true);
 assert.equal(followupSchema.safeParse({kind:"form",question:"Details?",fields:[field,field]}).success,false);
 assert.equal(followupSchema.safeParse({kind:"form",question:"Details?",fields:[{...field,options:undefined}]}).success,false);
});
