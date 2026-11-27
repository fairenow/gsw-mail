import {followupSchema,type Followup} from "./communityFollowups.js";
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
 return db.select({id:aiConversations.id,title:aiConversations.title,lastMessageAt:aiConversations.lastMessageAt,status:aiConversations.status}).from(aiConversations).where(scope(owner)).orderBy(desc(aiConversations.lastMessageAt)).limit(50);
}
export async function communityTranscript(owner:Owner,id:string){
 await communityConversation(owner,id,"");
 const rows=await db.select({role:aiMessages.role,content:aiMessages.content,metadata:aiMessages.metadata}).from(aiMessages).where(eq(aiMessages.conversationId,id)).orderBy(desc(aiMessages.createdAt),desc(aiMessages.id)).limit(32);
 return rows.reverse().flatMap(row=>{if(row.role!=="user"&&row.role!=="assistant")return [];const followup=row.role==="assistant"?followupSchema.safeParse((row.metadata as {followup?:unknown}|null)?.followup):null;return [{role:row.role as "user"|"assistant",content:row.content,...(followup?.success?{followup:followup.data as Followup}:{})}];});
}

export async function manageCommunityConversation(owner:Owner,id:string,operation:"rename"|"archive"|"restore"|"delete",title?:string){
 const where=and(scope(owner),eq(aiConversations.id,id));
 if(operation==="delete"){
  const [row]=await db.delete(aiConversations).where(where).returning({id:aiConversations.id});
  if(!row)throw notFound();return {deleted:true};
 }
 const patch=operation==="rename"?{title:title!.trim().slice(0,120),updatedAt:new Date()}:{status:operation==="archive"?"archived":"active",updatedAt:new Date()};
 const [row]=await db.update(aiConversations).set(patch).where(where).returning({id:aiConversations.id,title:aiConversations.title,status:aiConversations.status});
 if(!row)throw notFound();return {conversation:row};
}
