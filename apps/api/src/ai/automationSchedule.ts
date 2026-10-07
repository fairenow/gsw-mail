export type AutomationFrequency = "once" | "daily" | "weekdays" | "weekends" | "weekly" | "monthly";

export interface AutomationSchedule {
  frequency: AutomationFrequency;
  hour: number;
  minute: number;
  daysOfWeek?: number[] | undefined;
  dayOfMonth?: number | undefined;
  interval?: number | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
};

const weekdayMap: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: weekdayMap[value("weekday")] ?? 0,
  };
}

export function zonedDateTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = localParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const delta = targetAsUtc - actualAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

const parseLocalDate = (value?: string) => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const localDateKey = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const daysBetween = (a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }) =>
  Math.floor((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);

const monthsBetween = (a: { year: number; month: number }, b: { year: number; month: number }) =>
  (b.year - a.year) * 12 + (b.month - a.month);

const dateMatches = (
  schedule: AutomationSchedule,
  date: { year: number; month: number; day: number; weekday: number },
): boolean => {
  const interval = Math.max(1, Math.floor(schedule.interval ?? 1));
  const start = parseLocalDate(schedule.startDate);
  const currentKey = localDateKey(date.year, date.month, date.day);
  if (schedule.startDate && currentKey < schedule.startDate) return false;
  if (schedule.endDate && currentKey > schedule.endDate) return false;

  if (schedule.frequency === "once") {
    return schedule.startDate ? currentKey === schedule.startDate : true;
  }

  if (schedule.frequency === "weekdays" && (date.weekday === 0 || date.weekday === 6)) return false;
  if (schedule.frequency === "weekends" && date.weekday !== 0 && date.weekday !== 6) return false;

  if (schedule.frequency === "weekly") {
    const days = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [start ? new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay() : date.weekday];
    if (!days.includes(date.weekday)) return false;
  }

  if (schedule.frequency === "monthly") {
    const desiredDay = schedule.dayOfMonth ?? start?.day ?? date.day;
    if (date.day !== desiredDay) return false;
  }

  if (!start || interval === 1) return true;
  const diffDays = daysBetween(start, date);
  if (diffDays < 0) return false;

  if (schedule.frequency === "daily" || schedule.frequency === "weekdays" || schedule.frequency === "weekends") {
    return diffDays % interval === 0;
  }
  if (schedule.frequency === "weekly") return Math.floor(diffDays / 7) % interval === 0;
  if (schedule.frequency === "monthly") return monthsBetween(start, date) % interval === 0;
  return true;
};

export function computeNextAutomationRun(
  schedule: AutomationSchedule,
  timeZone: string,
  from = new Date(),
): Date | null {
  if (!Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23) return null;
  if (!Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) return null;

  const current = localParts(from, timeZone);
  const base = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const minFuture = from.getTime() + 5_000;

  for (let offset = 0; offset <= 730; offset += 1) {
    const d = new Date(base.getTime() + offset * 86_400_000);
    const localDate = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      weekday: d.getUTCDay(),
    };
    if (!dateMatches(schedule, localDate)) continue;
    const candidate = zonedDateTimeToUtc(timeZone, localDate.year, localDate.month, localDate.day, schedule.hour, schedule.minute);
    if (candidate.getTime() >= minFuture) return candidate;
    if (schedule.frequency === "once" && schedule.startDate) return null;
  }
  return null;
}
