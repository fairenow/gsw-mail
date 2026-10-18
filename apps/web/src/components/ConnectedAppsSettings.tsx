import { useEffect, useState } from "react";
import { api, type ConnectedOAuthApp, type OAuthConnectionEvent } from "../api";

export function ConnectedAppsSettings() {
  const [apps,setApps]=useState<ConnectedOAuthApp[]>([]);
  const [events,setEvents]=useState<OAuthConnectionEvent[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");
  const reload=async()=>{
    setLoading(true);
    try{const [connections,activity]=await Promise.all([api.connectedApps(),api.connectedAppActivity()]);setApps(connections.connections);setEvents(activity.events);setError("");}
    catch(e){setError(e instanceof Error?e.message:"Unable to load connected apps");}
    finally{setLoading(false);}
  };
  useEffect(()=>{void reload();},[]);
  const disconnect=async (app:ConnectedOAuthApp)=>{
    if(!window.confirm(`Disconnect ${app.name}? It will lose access to GSW Mail until you authorize it again.`))return;
    setBusy(app.clientId);
    try {await api.disconnectConnectedApp(app.clientId);await reload();}
    catch(e){setError(e instanceof Error?e.message:"Could not disconnect app");}
    finally{setBusy(null);}
  };
  return <div className="gsw-settings-card">
    <div className="gsw-settings-card-head"><div><h2>Connected Apps</h2><p>Manage apps you have authorized to access GSW Mail. Disconnecting a client revokes its GSW MCP access.</p></div><button className="gsw-secondary-btn" disabled={loading} onClick={()=>void reload()}>Refresh</button></div>
    {error && <p role="alert">{error}</p>}
    {loading?<p>Loading connected apps…</p>:apps.length===0?<p>No authorized applications yet. Once you connect ChatGPT or Claude, they will appear here.</p>:
      <div>{apps.map(app=><div key={app.consentId} className="gsw-settings-card" style={{marginBottom:12}}>
        <div className="gsw-settings-card-head"><div><h3>{app.name}</h3><p>{app.website||"Registered OAuth application"}</p><small>{app.disabled?"Client disabled":app.activeRefreshAuthorization?"Active refresh authorization":"Authorized consent"} · Approved {new Date(app.approvedAt).toLocaleDateString()}</small></div>
          <button className="gsw-secondary-btn" disabled={busy!==null} onClick={()=>void disconnect(app)}>{busy===app.clientId?"Disconnecting…":"Disconnect"}</button></div>
        <div><strong>Permissions</strong><div role="region" aria-label={`${app.name} granted scopes`} tabIndex={0} style={{ maxHeight: 176, overflowY: "auto", overscrollBehavior: "contain", border: "1px solid var(--border, #d8d8d8)", borderRadius: 10, padding: "8px 12px", marginTop: 8 }}>
          {app.scopes.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{app.scopes.map(scope => <li key={scope} style={{ overflowWrap: "anywhere", paddingBlock: 3 }}>{scope}</li>)}</ul> : <p style={{ margin: 0 }}>No scopes</p>}
        </div></div>
      </div>)}</div>}
    <h3>Recent connection activity</h3>
    {events.length===0?<p>No connection activity recorded yet.</p>:<ul>{events.slice(0,20).map((e,i)=><li key={`${e.createdAt}-${i}`}>{e.action} · {e.resourceId??"Unknown app"} · {new Date(e.createdAt).toLocaleString()}</li>)}</ul>}
  </div>;
}
