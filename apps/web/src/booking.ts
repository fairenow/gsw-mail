export const meetingDurations = [15, 20, 30, 45, 60] as const;
export type EventLinkSettingsData = {
  name: string;
  slug: string;
  calendarId: string;
  timeZone: string;
  enabled: boolean;
  mode: "fixed" | "windows";
  duration: number;
  allowedDurations: number[];
  windows: { day: number; start: string; end: string }[];
  fixedSlots: { date: string; start: string }[];
  unavailableDates: string[];
  approval: "manual" | "auto";
  phoneRequired: boolean;
  messageRequired: boolean;
  noticeHours: number;
  location: string;
  meetingUrl: string;
  generateMeeting: boolean;
};
export type SavedEventLink = EventLinkSettingsData & {
  id: string;
  url: string;
};
export type EventBooking = {
  id: string;
  link_id: string;
  link_name: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  starts_at: string;
  ends_at: string;
  status: string;
  hold_until: string;
  email_needs_attention: boolean;
  meeting_url: string | null;
};
export type PublicEventLink = Pick<
  EventLinkSettingsData,
  | "name"
  | "slug"
  | "timeZone"
  | "mode"
  | "duration"
  | "allowedDurations"
  | "phoneRequired"
  | "messageRequired"
  | "approval"
  | "location"
> & { first: string; last: string };
export type BookingSlots = {
  days: Record<string, { start: string; end: string }[]>;
  first: string;
  last: string;
  timeZone: string;
};
