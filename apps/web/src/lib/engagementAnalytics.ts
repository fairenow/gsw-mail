/**
 * First-party, privacy-minimized usage analytics.
 * No text content, URL query strings, document titles, form values or raw coordinates.
 */
type EventType = "page_view" | "click" | "scroll_depth" | "page_exit" | "visibility" | "web_vital";
type Event = { id: string; type: EventType; path: string; occurredAt: string; sessionId: string; visitorId: string; metadata?: Record<string,string|number|boolean> };
const UUID = () => crypto.randomUUID();
const SESSION_KEY = "gsw_analytics_session";
const VISITOR_KEY = "gsw_analytics_visitor";
const path = () => location.pathname.replace(/\/([0-9a-f]{8}-[0-9a-f-]{27,}|[^/]{24,})/gi, "/:id").slice(0,160);
const getId = (store: Storage, key: string) => { try { let id = store.getItem(key); if (!id) { id=UUID(); store.setItem(key,id); } return id; } catch { return UUID(); } };
function safeTarget(element: Element): string {
  const target = element.closest("[data-analytics],button,a,[role=button],input[type=submit],input[type=button]") as HTMLElement | null;
  if (!target) return "";
  if (target.closest("[data-analytics-ignore],[data-private]") || target.matches("[data-analytics-ignore],[data-private]")) return "";
  const label = target.getAttribute("data-analytics");
  if (label && /^[a-zA-Z0-9_:.-]{1,64}$/.test(label)) return label;
  const tag=target.tagName.toLowerCase();
  const type=target.getAttribute("type");
  // Only bounded semantic attributes; no textContent, href, ID, name or aria-label (may contain private data).
  return ["button","a"].includes(tag) ? tag : type==="submit" ? "submit" : tag==="input" && type==="button" ? "input_button" : "";
}
export function startEngagementAnalytics(): () => void {
  if (typeof window==="undefined" || navigator.doNotTrack==="1" || (navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl) return () => {};
  const visitorId=getId(localStorage,VISITOR_KEY),sessionId=getId(sessionStorage,SESSION_KEY);
  let currentScreen="";
  const resolvedPath=()=>path()==="/mail"&&currentScreen?"/mail/"+currentScreen:path();
  let pending:Event[]=[];let previousPath=resolvedPath();let enteredAt=Date.now();let maxScroll=0;let lastActive=Date.now();
  const milestones=new Set<number>();let timer:number|undefined;
  const queue=(type:EventType,metadata?:Record<string,string|number|boolean>)=>{
    if (pending.length>=100) pending.shift();
    pending.push({id:UUID(),type,path:previousPath,occurredAt:new Date().toISOString(),sessionId,visitorId,...(metadata?{metadata}:{})});
    if (pending.length>=15) flush();
  };
  const flush=(unloading=false)=>{
    if (!pending.length) return;
    const payload=JSON.stringify({events:pending.slice(0,50)});
    pending=pending.slice(50);
    if (unloading && navigator.sendBeacon) {
      if (navigator.sendBeacon("/product/analytics/events",new Blob([payload],{type:"application/json"}))) return;
    }
    void fetch("/product/analytics/events",{method:"POST",headers:{"content-type":"application/json"},body:payload,credentials:"include",keepalive:unloading}).catch(()=>{});
  };
  const exit=()=>{queue("page_exit",{durationMs:Math.max(0,Date.now()-enteredAt),scrollPercent:maxScroll});};
  const route=()=>{
    const next=resolvedPath();
    if(next===previousPath) return;
    exit();previousPath=next;enteredAt=Date.now();maxScroll=0;milestones.clear();queue("page_view");
  };
  const screen=(e:Event)=>{const name=(e as CustomEvent<{screen?:string}>).detail?.screen;if(typeof name==="string"&&/^[a-zA-Z0-9/_-]{1,64}$/.test(name)){currentScreen=name;route();}};
  const click=(e:MouseEvent)=>{
    if(!(e.target instanceof Element))return;
    const target=safeTarget(e.target);
    if(target)queue("click",{target});
    lastActive=Date.now();
  };
  const scroll=()=>{
    lastActive=Date.now();
    const extent=document.documentElement.scrollHeight-innerHeight;
    const percent=extent<=0?100:Math.min(100,Math.round((scrollY/extent)*100));
    maxScroll=Math.max(maxScroll,percent);
    for(const m of [25,50,75,90,100])if(percent>=m&&!milestones.has(m)){milestones.add(m);queue("scroll_depth",{percent:m});}
  };
  const visibility=()=>{if(document.visibilityState==="hidden"){queue("visibility",{state:"hidden"});flush(true);}else{queue("visibility",{state:"visible"});lastActive=Date.now();}};
  const pagehide=()=>{exit();flush(true);};
  window.addEventListener("gsw-analytics-screen",screen);
  document.addEventListener("click",click,{capture:true});
  document.addEventListener("scroll",scroll,{passive:true,capture:true});
  document.addEventListener("visibilitychange",visibility);
  window.addEventListener("popstate",route);
  window.addEventListener("pagehide",pagehide);
  const pushState=history.pushState,replaceState=history.replaceState;
  history.pushState=function(...args){const result=pushState.apply(this,args);route();return result;};
  history.replaceState=function(...args){const result=replaceState.apply(this,args);route();return result;};
  timer=window.setInterval(()=>{route();if(pending.length)flush();if(document.visibilityState==="visible"&&Date.now()-lastActive<30000)queue("visibility",{state:"active"});},10000);
  queue("page_view");scroll();
  // Official Google web-vitals package measures finalized CWV values.
  void import("web-vitals").then(({onCLS,onINP,onLCP,onFCP,onTTFB})=>{
    const report=(metric:{name:string;value:number})=>queue("web_vital",{metric:metric.name,value:Math.round(metric.value*1000)/1000});
    onCLS(report);onINP(report);onLCP(report);onFCP(report);onTTFB(report);
  }).catch(()=>{});
  return ()=>{if(timer)clearInterval(timer);window.removeEventListener("gsw-analytics-screen",screen);document.removeEventListener("click",click,true);document.removeEventListener("scroll",scroll,true);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("popstate",route);window.removeEventListener("pagehide",pagehide);history.pushState=pushState;history.replaceState=replaceState;flush(true);};
}
