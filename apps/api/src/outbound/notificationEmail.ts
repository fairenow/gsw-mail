import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { emailAccounts, mailAccountMemberships, users } from "../db/schema.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { submitSend } from "./sendFlow.js";

export async function queueNotificationEmail(input:{key:string;accountId:string;address:string;subject:string;textBody:string}) {
  const [owner]=await db.select({userId:users.id,authUserId:users.authUserId,address:emailAccounts.address}).from(emailAccounts).innerJoin(users,eq(users.id,emailAccounts.userId)).where(eq(emailAccounts.id,input.accountId)).limit(1);
  if(!owner || owner.address.toLowerCase()!==input.address.toLowerCase())throw new Error("Notification mailbox owner could not be verified");
  let authUserId=owner.authUserId;
  if(!authUserId) {
    const [binding]=await db.select({authUserId:mailAccountMemberships.authUserId}).from(mailAccountMemberships).where(and(eq(mailAccountMemberships.accountId,input.accountId),eq(mailAccountMemberships.userId,owner.userId),eq(mailAccountMemberships.role,"owner"))).limit(1);
    authUserId=binding?.authUserId??null;
  }
  if(!authUserId)throw new Error("Sign in to this mailbox to enable renewable reminder email delivery");
  const account=await requireAccountPermission(owner.userId,input.accountId,"send");
  const result=await submitSend({userId:owner.userId,authUserId,headers:{},account,to:[owner.address],subject:input.subject,textBody:input.textBody,templateKey:"none",clientRequestId:input.key});
  if(!["queued","sending","accepted"].includes(result.transportStatus))throw new Error(`Notification email requires review: ${result.transportStatus}`);
  return result.sendId;
}
