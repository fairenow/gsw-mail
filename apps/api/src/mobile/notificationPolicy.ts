export type PushCategory = "mail" | "calendar" | "chat" | "scheduledWork" | "workAttention" | "general";
export type PushPreferences = {mailEnabled:boolean;calendarEnabled:boolean;chatEnabled:boolean;scheduledWorkEnabled:boolean;workAttentionEnabled:boolean;calendarReminderMinutes:number};
export function pushCategoryEnabled(preferences:PushPreferences,category:PushCategory):boolean {
  switch(category) {
    case "mail":return preferences.mailEnabled;
    case "calendar":return preferences.calendarEnabled;
    case "chat":return preferences.chatEnabled;
    case "scheduledWork":return preferences.scheduledWorkEnabled;
    case "workAttention":return preferences.workAttentionEnabled;
    default:return true;
  }
}
export function calendarStartInstant(value:string,timeZone="UTC"):Date {
  if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const instant=new Date(value);
    if(!Number.isFinite(instant.getTime())) throw new Error("Invalid calendar start");
    return instant;
  }
  const match=value.replace(/\.\d+$/, "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if(!match) throw new Error("Invalid calendar local start");
  const parts=match.slice(1).map(value=>Number(value??0));
  const wall=Date.UTC(parts[0]!,parts[1]!-1,parts[2]!,parts[3]??0,parts[4]??0,parts[5]??0);
  const formatter=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  let guess=wall;
  for(let i=0;i<4;i++) {
    const p=Object.fromEntries(formatter.formatToParts(guess).map(part=>[part.type,part.value]));
    const actual=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
    if(actual===wall)return new Date(guess);
    guess+=wall-actual;
  }
  throw new Error("Calendar start does not exist in the selected time zone");
}
