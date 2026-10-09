import type { EngineCalendarEvent } from "../../engine/types.js";

/** Conservative free/busy estimate based on visible event times, not attendee availability. */
export function computeCalendarConflicts(events: EngineCalendarEvent[], startIso: string, endIso: string, excludeEventId?: string) {
  const start = Date.parse(startIso), end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("invalid interval");
  return events.filter((event) => {
    if (event.engineId === excludeEventId) return false;
    const begin = Date.parse(event.start);
    // Events with no valid end have unknown duration and must be reported separately.
    const finish = event.end ? Date.parse(event.end) : NaN;
    return Number.isFinite(begin) && Number.isFinite(finish) && begin < end && finish > start;
  }).map((event) => ({ eventId: event.engineId, title: event.title, start: event.start, end: event.end }));
}

export function calculateFreeSlots(events: EngineCalendarEvent[], startIso: string, endIso: string, durationMinutes: number) {
  const start = Date.parse(startIso), end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || durationMinutes < 1) throw new Error("invalid interval");
  const periods = events.map(event => ({ start: Date.parse(event.start), end: event.end ? Date.parse(event.end) : NaN }))
    .filter(period => Number.isFinite(period.start) && Number.isFinite(period.end) && period.end > start && period.start < end)
    .map(period => ({ start: Math.max(period.start, start), end: Math.min(period.end, end) }))
    .sort((a,b)=>a.start-b.start);
  const slots: Array<{ start: string; end: string }> = [];
  let cursor = start;
  for (const period of periods) {
    if (period.start - cursor >= durationMinutes * 60000) slots.push({ start: new Date(cursor).toISOString(), end: new Date(period.start).toISOString() });
    cursor = Math.max(cursor, period.end);
  }
  if (end - cursor >= durationMinutes * 60000) slots.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
  return slots;
}
