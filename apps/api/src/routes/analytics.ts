import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireUser } from "../auth/middleware.js";
const eventSchema=z.object({
 id:z.string().uuid(),type:z.enum(["page_view","click","scroll_depth","page_exit","visibility","web_vital"]),
 path:z.string().max(160).regex(/^\/[a-zA-Z0-9_:\-/]*$/),occurredAt:z.string().datetime(),
 sessionId:z.string().uuid(),visitorId:z.string().uuid(),
 metadata:z.record(z.union([z.string().max(64),z.number().finite(),z.boolean()])).optional()
}).strict();
const requestSchema=z.object({events:z.array(eventSchema).min(1).max(50)}).strict();
export default async function analyticsRoutes(app:FastifyInstance){
 // Anonymous visitors are intentionally not associated with mailbox identities.
 app.post("/product/analytics/events",{config:{rateLimit:{max:90,timeWindow:"1 minute"}}},async(req,reply)=>{
   if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return reply.code(403).send({error:"invalid origin"});
   const events=requestSchema.parse(req.body).events;
   const keys:Record<string,string[]>={page_view:[],click:["target"],scroll_depth:["percent"],page_exit:["durationMs","scrollPercent"],visibility:["state"],web_vital:["metric","value"]};
   for(const event of events){if(Object.keys(event.metadata??{}).some(key=>!keys[event.type]!.includes(key)))return reply.code(400).send({error:"unsupported analytics metadata"});}
   const client=await pool.connect();
   try{
     await client.query("BEGIN");
     for(const event of events){
       if(Math.abs(Date.now()-Date.parse(event.occurredAt))>86400000)continue;
       await client.query(`INSERT INTO engagement_events (id,event_type,path,session_id,visitor_id,occurred_at,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING`,
         [event.id,event.type,event.path,event.sessionId,event.visitorId,event.occurredAt,JSON.stringify(event.metadata??{})]);
     }
     await client.query("COMMIT");
   }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
   return reply.code(202).send({accepted:true});
 });
 // Owner-controlled reporting only, never a public read API.
 app.register(async secured=>{
   await requireUser(secured,{optional:false});
   secured.get("/product/analytics/summary",async(req,reply)=>{
     // Explicit gate: access to this route is server-owner only, not every signed-in mailbox user.
     if(!process.env.ANALYTICS_ADMIN_USER_ID || req.authUserId!==process.env.ANALYTICS_ADMIN_USER_ID)
       return reply.code(403).send({error:"forbidden"});
     const [stats,paths]=await Promise.all([
       pool.query(`SELECT COUNT(*)::int AS events,COUNT(DISTINCT visitor_id)::int AS visitors,COUNT(DISTINCT session_id)::int AS sessions FROM engagement_events WHERE occurred_at>=NOW()-INTERVAL '30 days'`),
       pool.query(`SELECT path,COUNT(*)::int AS views FROM engagement_events WHERE event_type='page_view' AND occurred_at>=NOW()-INTERVAL '30 days' GROUP BY path ORDER BY views DESC LIMIT 25`)
     ]);
     return {period:"30d",...stats.rows[0],topPages:paths.rows};
   });
 });
}
