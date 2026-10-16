import type { AgentToolDefinition, AgentExecutionContext } from "./types.js";
import { addProposalComment, getProposal, listProposalComments, listProposals } from "../proposalConversation.js";

const audit=(ctx:AgentExecutionContext,startedAt:string)=>({userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()});
const asInput=(value:unknown)=>value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};
const fail=(ctx:AgentExecutionContext,toolCallId:string,startedAt:string)=>({ok:false,toolCallId,error:{code:"proposal_request_failed",message:"Proposal operation unavailable or not permitted.",retryable:false},audit:audit(ctx,startedAt)});

export const proposalConversationTools: AgentToolDefinition[]=[
  {
    name:"proposal.list",description:"List current GSW AI proposals for your selected account.",
    inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:50}},additionalProperties:false},
    requiredScopes:[],risk:"read",
    async execute(ctx,input,toolCallId){
      const startedAt=new Date().toISOString();
      try{const v=asInput(input);const limit=typeof v.limit==="number" && Number.isInteger(v.limit)?v.limit:20;
        if(limit<1||limit>50)throw new Error("invalid_limit");
        return {ok:true,toolCallId,data:{proposals:await listProposals(ctx.accountId,limit)},audit:audit(ctx,startedAt)};
      }catch{return fail(ctx,toolCallId,startedAt);}
    }
  },
  {
    name:"proposal.get",description:"Read a GSW AI proposal and its discussion history.",
    inputSchema:{type:"object",properties:{proposalId:{type:"string",format:"uuid"}},required:["proposalId"],additionalProperties:false},
    requiredScopes:[],risk:"read",
    async execute(ctx,input,toolCallId){
      const startedAt=new Date().toISOString();
      try{const v=asInput(input);if(typeof v.proposalId!=="string")throw new Error("invalid_id");
        const proposal=await getProposal(ctx.accountId,v.proposalId);
        if(!proposal)throw new Error("not_found");
        const comments=await listProposalComments(ctx.accountId,v.proposalId);
        return {ok:true,toolCallId,data:{proposal,comments},audit:audit(ctx,startedAt)};
      }catch{return fail(ctx,toolCallId,startedAt);}
    }
  },
  {
    name:"proposal.comment",description:"Add a comment, follow-up evidence, or implementation suggestion to a GSW proposal. Does not approve execution.",
    inputSchema:{type:"object",properties:{proposalId:{type:"string",format:"uuid"},body:{type:"string",minLength:1,maxLength:10000}},required:["proposalId","body"],additionalProperties:false},
    requiredScopes:[],risk:"reversible_write",
    async execute(ctx,input,toolCallId){
      const startedAt=new Date().toISOString();
      try{const v=asInput(input);if(typeof v.proposalId!=="string"||typeof v.body!=="string")throw new Error("invalid_input");
        const comment=await addProposalComment({accountId:ctx.accountId,userId:ctx.userId,proposalId:v.proposalId,body:v.body});
        return {ok:true,toolCallId,data:{comment},audit:audit(ctx,startedAt)};
      }catch{return fail(ctx,toolCallId,startedAt);}
    }
  }
];
