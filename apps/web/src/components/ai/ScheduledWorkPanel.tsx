import { useCallback, useEffect, useState } from "react";
import { CalendarClock, RefreshCw, Trash2, Plus, Clock3, Play, Pause, History, Pencil, ArrowRight } from "lucide-react";
import "../../styles/scheduled-work.css";
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
  return <section aria-label="Scheduled Work" className="gsw-work-page">
    <header className="gsw-work-header">
      <div><p className="gsw-work-eyebrow">YOUR AI ASSISTANT</p><h2>Scheduled Work</h2><p>Automate the work that matters. Review schedules, activity and results in one place.</p></div>
      <div className="gsw-work-header-actions"><button className="gsw-work-icon-btn" type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Refresh scheduled work"><RefreshCw size={17}/></button><button className="gsw-work-primary-btn" type="button" onClick={beginCreate}><Plus size={16}/> New task</button></div>
    </header>
    <div className="gsw-work-summary"><span><strong>{items.length}</strong> total tasks</span><span><strong>{items.filter(item=>item.status==="active").length}</strong> active</span><span><strong>{items.filter(item=>item.status==="paused").length}</strong> paused</span></div>
    {error&&<p role="alert" style={{color:"#b45309"}}>{error}</p>}
    {editing&&<form onSubmit={e=>{e.preventDefault();void save();}} className="gsw-work-editor">
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
    <div className="gsw-work-list">{items.map(item=><article key={item.id} className="gsw-work-card">
      <div className="gsw-work-card-heading"><div className="gsw-work-card-icon"><CalendarClock size={19}/></div><div className="gsw-work-card-title"><h3>{item.title}</h3><span className={`gsw-work-status gsw-work-status-${item.status}`}>{item.status}</span></div></div>
      <p className="gsw-work-instruction">{item.instruction}</p>
      <div className="gsw-work-meta"><span><Clock3 size={15}/> Next: {displayTime(item.nextRunAt)}</span><span>Repeats {item.schedule.frequency} at {String(item.schedule.hour).padStart(2,"0")}:{String(item.schedule.minute).padStart(2,"0")} ({item.timeZone})</span><span>Last: {displayTime(item.lastRunAt)}</span></div>
      {item.lastError&&<p role="status" style={{color:"#b45309"}}>Last error: {item.lastError}</p>}
      <div className="gsw-work-card-actions">
        <button type="button" onClick={()=>beginEdit(item)}><Pencil size={15}/> Edit</button>
        {item.status==="active"||item.status==="paused"?<button type="button" onClick={()=>void changeStatus(item,item.status==="active"?"paused":"active")}>{item.status==="active"?<Pause size={15}/>:<Play size={15}/>} {item.status==="active"?"Pause":"Resume"}</button>:null}
        <button type="button" onClick={()=>setSelected(selected===item.id?null:item.id)}><History size={15}/> Run history <ArrowRight size={14}/></button>
        <button className="gsw-work-delete" type="button" onClick={()=>void remove(item)} aria-label={`Delete ${item.title}`}><Trash2 size={15}/></button>
      </div>
      {selected===item.id&&!editing&&<div style={{marginTop:12,borderTop:"1px solid #d6c9b4",paddingTop:10}}><strong>Recent runs</strong>{runs.length===0?<p>No runs recorded.</p>:runs.map(run=><div key={run.id} style={{marginTop:10}}><small>{displayTime(run.startedAt)} · {run.status}</small>{run.result&&<p style={{whiteSpace:"pre-wrap"}}>{run.result}</p>}{run.errorMessage&&<p role="status">{run.errorMessage}</p>}</div>)}</div>}
    </article>)}</div>
  </section>;
}
