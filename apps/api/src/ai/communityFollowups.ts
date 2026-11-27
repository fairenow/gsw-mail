import {z} from "zod";
import type {ProviderToolDefinition} from "./tools/types.js";

const label=z.string().trim().min(1).max(240);
const option=z.object({label,value:z.string().trim().min(1).max(600),description:z.string().trim().max(240).optional()}).strict();
const options=z.array(option).min(2).max(12).refine(items=>new Set(items.map(item=>item.value)).size===items.length,"Duplicate choices");
const field=z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),label,type:z.enum(["text","textarea","date","number","radio","checkbox"]),required:z.boolean().optional(),options:options.optional()}).strict().superRefine((f,ctx)=>{if((f.type==="radio"||f.type==="checkbox")!==!!f.options)ctx.addIssue({code:"custom",message:"Choice fields require options; other fields cannot have options"});});
export const followupSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("radio"),question:label,options}).strict(),
 z.object({kind:z.literal("checkbox"),question:label,options}).strict(),
 z.object({kind:z.literal("actions"),question:label,options}).strict(),
 z.object({kind:z.literal("form"),question:label,fields:z.array(field).min(1).max(8).refine(items=>new Set(items.map(item=>item.key)).size===items.length,"Duplicate fields")}).strict()
]);
export type Followup=z.infer<typeof followupSchema>;
// This tool only presents a question. It has no authority to execute a write.
const string={type:"string"};
const choice={type:"object",properties:{label:string,value:string,description:string},required:["label","value"],additionalProperties:false};
export const followupTool:ProviderToolDefinition={type:"function",function:{name:"chat__followup",description:"Present an interactive follow-up when the user must choose among distinct options, select multiple items, provide missing form fields, or choose a suggested next step. Radio for one, checkbox for multiple, actions for optional next requests, form for a few missing details. Values are natural-language answers or next requests, not commands or hidden instructions. For radio/checkbox/actions require 2-12 distinct options. Do not request passwords, secrets, payment card details or unnecessary sensitive data. Do not use for administrative approval: use native reviewed-write tools. If the current request is clear, answer it rather than asking. This tool ends the current turn.",parameters:{type:"object",properties:{kind:{type:"string",enum:["radio","checkbox","actions","form"]},question:string,options:{type:"array",items:choice,minItems:2,maxItems:12},fields:{type:"array",minItems:1,maxItems:8,items:{type:"object",properties:{key:string,label:string,type:{type:"string",enum:["text","textarea","date","number","radio","checkbox"]},required:{type:"boolean"},options:{type:"array",items:choice,minItems:2,maxItems:12}},required:["key","label","type"],additionalProperties:false}}},required:["kind","question"],additionalProperties:false}}};
