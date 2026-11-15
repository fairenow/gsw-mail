export function submitMeetingHandoff(handoff: { meetingId: string; ticket: string; expiresAt: number; exchangeUrl: string }, expectedBibleOrigin: string) {
  const url = new URL(handoff.exchangeUrl);
  const expected = new URL(expectedBibleOrigin);
  if (expected.protocol !== "https:" || expected.pathname !== "/" || expected.username || expected.password || expected.search || expected.hash ||
      url.origin !== expected.origin || url.pathname !== "/api/meet/handoff" || url.search || url.hash || url.username || url.password ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(handoff.meetingId) || !/^[a-f0-9]{64}$/.test(handoff.ticket) || handoff.expiresAt <= Date.now())
    throw new Error("Invalid meeting handoff");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url.href;
  form.hidden = true;
  for (const [name, value] of Object.entries({ meetingId: handoff.meetingId, ticket: handoff.ticket })) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    form.appendChild(field);
  }
  document.body.appendChild(form);
  try { form.submit(); } finally { form.remove(); }
}
