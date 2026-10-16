import type { AgentToolDefinition } from "./types.js";
import { submitAiProposal } from "../proposalStore.js";
import { proposalToolSchema, validateMcpProposal } from "../../mcp/proposalContract.js";

export const proposalSubmitTool: AgentToolDefinition = {
  name: "proposal.submit",
  description: "Report an observed GSW bug, new connection opportunity, improvement, security issue, or open question to the owner for review. The proposal is saved; it does not execute changes or guarantee email delivery.",
  inputSchema: proposalToolSchema as unknown as Record<string, unknown>,
  requiredScopes: [],
  risk: "reversible_write",
  async execute(ctx,input,toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const fields = validateMcpProposal(input);
      const result = await submitAiProposal({...fields,
        requesterUserId:ctx.userId,accountId:ctx.accountId,
        sourceClient:ctx.headers["x-gsw-agent-source"]?.slice(0,100) || "GSW AI"});
      return {ok:true,toolCallId,data:result,audit:{userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()}};
    } catch {
      return {ok:false,toolCallId,error:{code:"proposal_submission_failed",message:"Unable to save proposal.",retryable:true},
        audit:{userId:ctx.userId,accountId:ctx.accountId,startedAt,completedAt:new Date().toISOString()}};
    }
  }
};
export const proposalTools: AgentToolDefinition[] = [proposalSubmitTool];
