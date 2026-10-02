export type RecurrenceFrequency = "daily" | "weekdays" | "weekly" | "monthly";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  endAt?: string;
  maxOccurrences?: number;
};

export type ScheduleDraftInput = {
  scheduledFor: string;
  timeZone: string;
  recurrence?: RecurrenceRule;
};

export type ScheduledSendResult = {
  sendId: string;
  status: "scheduled";
  scheduledFor: string;
  seriesId: string;
  recurring: boolean;
  idempotentReplay?: boolean;
};

export async function scheduleDraft(
  id: string,
  input: ScheduleDraftInput & {
    accountId: string;
    clientRequestId?: string;
    mode?: "new" | "reply" | "replyAll" | "forward";
    templateKey?: string;
    bcc?: string[];
  },
): Promise<ScheduledSendResult> {
  const response = await fetch(`/mail/drafts/${encodeURIComponent(id)}/schedule`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? `request failed: ${response.status}`);
  }
  return response.json() as Promise<ScheduledSendResult>;
}

export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const supportedTimeZones = (): string[] => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  if (typeof intl.supportedValuesOf === "function") return intl.supportedValuesOf("timeZone");
  return [
    "UTC",
    "America/New_York",
    "America/Detroit",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Paris",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
};

const partsInZone = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === name)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
};

export function zonedDateTimeToIso(date: string, hour24: number, minute: number, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Choose a valid date.");
  const target = Date.UTC(year, month - 1, day, hour24, minute, 0);
  let guess = target;
  for (let index = 0; index < 4; index += 1) {
    const observed = partsInZone(new Date(guess), timeZone);
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    guess += target - observedUtc;
  }
  return new Date(guess).toISOString();
}
