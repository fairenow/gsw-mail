import { and,desc,eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiConversations,aiMessages } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

type Owner={userId:string;clientId:string;accountId:string};
function scope(owner:Owner){return and(eq(aiConversations.userId,owner.userId),eq(aiConversations.accountId,owner.accountId),eq(aiConversations.communityClientId,owner.clientId));}
export async function communityConversation(owner:Owner,id:string|undefined,firstMessage:string){
 if(id){const [existing]=await db.select().from(aiConversations).where(and(scope(owner),eq(aiConversations.id,id))).limit(1);if(!existing||existing.status!=="active")throw notFound();return existing;}
 const [row]=await db.insert(aiConversations).values({userId:owner.userId,accountId:owner.accountId,communityClientId:owner.clientId,title:firstMessage.slice(0,120),status:"active",lastMessageAt:new Date()}).returning();
 if(!row)throw new Error("Unable to create conversation");return row;
}
export async function listCommunityConversations(owner:Owner){
 return db.select({id:aiConversations.id,title:aiConversations.title,lastMessageAt:aiConversations.lastMessageAt}).from(aiConversations).where(and(scope(owner),eq(aiConversations.status,"active"))).orderBy(desc(aiConversations.lastMessageAt)).limit(50);
}
export async function communityTranscript(owner:Owner,id:string){
 await communityConversation(owner,id,"");
 const rows=await db.select({role:aiMessages.role,content:aiMessages.content}).from(aiMessages).where(eq(aiMessages.conversationId,id)).orderBy(desc(aiMessages.createdAt),desc(aiMessages.id)).limit(32);
 return rows.reverse().filter((row):row is {role:"user"|"assistant";content:string}=>row.role==="user"||row.role==="assistant");
}
