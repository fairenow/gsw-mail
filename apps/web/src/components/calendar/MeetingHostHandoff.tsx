import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { organizerLaunchUrl } from "../../lib/videoMeetingLink";
export function MeetingHostHandoff({accountId,status}:{accountId:string|undefined;status:Awaited<ReturnType<typeof api.videoMeetingStatus>>|null}) {
  const [meetingId]=useState(()=>typeof window!=="undefined"?new URLSearchParams(window.location.search).get("hostMeeting"):null);
  const started=useRef("");const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const valid=!!meetingId&&/^[a-zA-Z0-9_-]{1,200}$/.test(meetingId);
  async function launch(){
    if(!accountId||!meetingId||!status?.available||!status.webOrigin)return;
    setBusy(true);setError("");
    try{
      const result=await api.launchVideoMeeting({accountId,meetingId});
      const target=organizerLaunchUrl(result.url,status.webOrigin,meetingId);
      if(!target)throw Error("Invalid meeting destination.");
      window.location.replace(target);
    }catch{setError("We could not verify you as this meeting's organizer. Select the mailbox used to create it, check the workspace subscription, and retry.")}
    finally{setBusy(false)}
  }
  useEffect(()=>{
    if(!valid||!accountId||!status?.available)return;
    const key=`${accountId}:${meetingId}`;if(started.current===key)return;started.current=key;
    void launch();
  },[accountId,meetingId,status?.available,status?.webOrigin,valid]);
  if(!valid)return null;
  return <section className="gsw-calendar-form" aria-label="Meeting organizer sign-in"><h2>Continue to your private meeting</h2><p>{busy?"Verifying your organizer access…":!status?"Checking meeting access…":!status.available?"Hosting requires an enabled paid workspace. Select the mailbox used to create the meeting.":"Your meeting will open in the Bible Study App."}</p>{error&&<p role="alert">{error}</p>}<button className="gsw-primary-btn" disabled={busy||!status?.available} onClick={()=>void launch()}>Continue as organizer</button></section>;
}
