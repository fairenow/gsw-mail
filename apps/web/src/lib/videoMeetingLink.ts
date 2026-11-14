export function videoMeetingId(link: string | undefined, origin: string | null | undefined): string | null {
  if (!link || !origin) return null;
  try {
    const url=new URL(link);
    if(url.origin!==new URL(origin).origin||url.username||url.password||url.search||url.hash)return null;
    return /^\/meet\/([a-zA-Z0-9_-]{1,200})$/.exec(url.pathname)?.[1]??null;
  }catch{return null;}
}
export function organizerLaunchUrl(link: string, origin: string, meetingId: string): string | null {
  try {
    const url=new URL(link);
    return url.origin===origin&&url.pathname===`/meet/${meetingId}`&&!url.username&&!url.password&&!url.search&&/^#host=[a-f0-9]{64}$/.test(url.hash)?url.href:null;
  }catch{return null;}
}
