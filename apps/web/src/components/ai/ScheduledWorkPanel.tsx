import { useCallback, useEffect, useState } from "react";
import { CalendarClock, RefreshCw, Trash2 } from "lucide-react";
import { api, type ScheduledWorkRecord, type ScheduledWorkRun, type ScheduledWorkSchedule } from "../../api";

const initialSchedule: ScheduledWorkSchedule = { frequency:"daily", hour:8, minute:0 };
const displayTime = (value:string|null) => value ? new Date(value).toLocaleString() : "Not scheduled";

export function ScheduledWorkPanel({accountId,active}:{accountId:string|null|undefined;active:boolean}) {
  const [items,setItems]=useState<ScheduledWorkRecord[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [runs,setRuns]=useState<ScheduledWorkRun[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [editing,setEditing]=useState(false);
  const [title,setTitle]=useState("");
  const [instruction,setInstruction]=useState("");
  const [schedule,setSchedule]=useState<ScheduledWorkSchedule>(initialSchedule);
  const [timeZone,setTimeZone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Detroit");

  const refresh=useCallback(async()=>{
    setLoading(true);setError(null);
    try {setItems((await api.scheduledWork()).automations);}
    catch(e){setError(e instanceof Error?e.message:"Could not load scheduled work");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{if(active)void refresh();},[active,refresh]);
  useEffect(()=>{
    if(!active||!selected){setRuns([]);return;}
    void api.scheduledWorkRuns(selected).then(v=>setRuns(v.runs)).catch(e=>setError(e instanceof Error?e.message:"Could not load run history"));
  },[active,selected]);
  const beginCreate=()=>{setSelected(null);setTitle("");setInstruction("");setSchedule(initialSchedule);setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone||"America/Detroit");setEditing(true);};
  const beginEdit=(item:ScheduledWorkRecord)=>{setSelected(item.id);setTitle(item.title);setInstruction(item.instruction);setSchedule(item.schedule);setTimeZone(item.timeZone);setEditing(true);};
  const save=async()=>{
    if(!title.trim()||!instruction.trim()||!accountId)return;
    setSaving(true);setError(null);
    try {
      if(selected)await api.updateScheduledWork(selected,{title,instruction,schedule,timeZone});
      else await api.createScheduledWork({accountId,title,instruction,schedule,timeZone});
      setEditing(false);await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not save scheduled work");}
    finally{setSaving(false);}
  };
  const changeStatus=async(item:ScheduledWorkRecord,status:"active"|"paused")=>{
    setError(null);
    try{await api.updateScheduledWork(item.id,{status});await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Could not change status");}
  };
  const remove=async(item:ScheduledWorkRecord)=>{
    if(!window.confirm(`Permanently delete scheduled task "${item.title}" and its run history?`))return;
    setError(null);
    try{await api.deleteScheduledWork(item.id);if(selected===item.id)setSelected(null);await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Could not delete scheduled task");}
  };
  return <section aria-label="Scheduled Work" style={{height:"100%",overflowY:"auto",padding:"24px",color:"var(--gsw-text,inherit)"}}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div><h2 style={{margin:0,display:"flex",alignItems:"center",gap:10}}><CalendarClock size={23}/> Scheduled Work</h2><p style={{opacity:.7,margin:"8px 0"}}>Create, manage and review background AI tasks.</p></div>
      <div style={{display:"flex",gap:8}}><button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Refresh scheduled work"><RefreshCw size={18}/></button><button type="button" onClick={beginCreate}>+ New task</button></div>
    </header>
    {error&&<p role="alert" style={{color:"#b45309"}}>{error}</p>}
    {editing&&<form onSubmit={e=>{e.preventDefault();void save();}} style={{display:"grid",gap:12,padding:16,border:"1px solid #d6c9b4",borderRadius:12,margin:"16px 0"}}>
      <h3 style={{margin:0}}>{selected?"Edit task":"New scheduled task"}</h3>
      <label>Task name<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} style={{display:"block",width:"100%",padding:9}}/></label>
      <label>Instructions<textarea required value={instruction} onChange={e=>setInstruction(e.target.value)} rows={5} style={{display:"block",width:"100%",padding:9}} placeholder="Review new inbox messages and summarize important items, replies needed, and follow-ups."/></label>
      <label>Repeat<select value={schedule.frequency} onChange={e=>setSchedule({...schedule,frequency:e.target.value as ScheduledWorkSchedule["frequency"]})} style={{display:"block",padding:8}}>{["once","daily","weekdays","weekends","weekly","monthly"].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
      {schedule.frequency==="weekly"&&<label>Day of week<select value={schedule.daysOfWeek?.[0]??1} onChange={e=>setSchedule({...schedule,daysOfWeek:[Number(e.target.value)]})}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((x,i)=><option key={x} value={i}>{x}</option>)}</select></label>}
      {schedule.frequency==="monthly"&&<label>Day of month<input type="number" min={1} max={31} value={schedule.dayOfMonth??1} onChange={e=>setSchedule({...schedule,dayOfMonth:Number(e.target.value)})}/></label>}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}><label>Hour (24h)<input type="number" min={0} max={23} required value={schedule.hour} onChange={e=>setSchedule({...schedule,hour:Number(e.target.value)})}/></label><label>Minute<input type="number" min={0} max={59} required value={schedule.minute} onChange={e=>setSchedule({...schedule,minute:Number(e.target.value)})}/></label></div>
      <label>Time zone<input required value={timeZone} onChange={e=>setTimeZone(e.target.value)} style={{display:"block",padding:8}}/></label>
      <small>Tasks use mailbox read access. Creating a task does not automatically authorize sending emails.</small>
      <div style={{display:"flex",gap:10}}><button type="submit" disabled={saving||!accountId}>{saving?"Saving…":"Save task"}</button><button type="button" onClick={()=>setEditing(false)}>Cancel</button></div>
    </form>}
    {!loading&&items.length===0&&!editing&&<p style={{padding:20,opacity:.75}}>No scheduled tasks found. Create one here to get started.</p>}
    <div style={{display:"grid",gap:12,marginTop:16}}>{items.map(item=><article key={item.id} style={{border:"1px solid #d6c9b4",borderRadius:12,padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>{item.title}</strong><span>{item.status}</span></div>
      <p style={{whiteSpace:"pre-wrap",opacity:.8}}>{item.instruction}</p>
      <p style={{fontSize:13,opacity:.75}}>Next: {displayTime(item.nextRunAt)} · Last: {displayTime(item.lastRunAt)} · {item.schedule.frequency} at {String(item.schedule.hour).padStart(2,"0")}:{String(item.schedule.minute).padStart(2,"0")} ({item.timeZone})</p>
      {item.lastError&&<p role="status" style={{color:"#b45309"}}>Last error: {item.lastError}</p>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" onClick={()=>beginEdit(item)}>Edit</button>
        {item.status==="active"||item.status==="paused"?<button type="button" onClick={()=>void changeStatus(item,item.status==="active"?"paused":"active")}>{item.status==="active"?"Pause":"Resume"}</button>:null}
        <button type="button" onClick={()=>setSelected(selected===item.id?null:item.id)}>Run history</button>
        <button type="button" onClick={()=>void remove(item)} aria-label={`Delete ${item.title}`}><Trash2 size={16}/></button>
      </div>
      {selected===item.id&&!editing&&<div style={{marginTop:12,borderTop:"1px solid #d6c9b4",paddingTop:10}}><strong>Recent runs</strong>{runs.length===0?<p>No runs recorded.</p>:runs.map(run=><div key={run.id} style={{marginTop:10}}><small>{displayTime(run.startedAt)} · {run.status}</small>{run.result&&<p style={{whiteSpace:"pre-wrap"}}>{run.result}</p>}{run.errorMessage&&<p role="status">{run.errorMessage}</p>}</div>)}</div>}
    </article>)}</div>
  </section>;
}
