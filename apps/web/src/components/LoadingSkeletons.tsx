export function MailListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="gsw-mail-skeleton-list" role="status" aria-label="Loading messages">
      {Array.from({ length: rows }, (_, index) => (
        <div className="gsw-mail-skeleton-row" key={index} aria-hidden="true">
          <span className="gsw-skeleton gsw-mail-skeleton-avatar" />
          <span className="gsw-mail-skeleton-copy">
            <span className="gsw-skeleton gsw-mail-skeleton-sender" />
            <span className="gsw-skeleton gsw-mail-skeleton-subject" />
            <span className="gsw-skeleton gsw-mail-skeleton-preview" />
          </span>
        </div>
      ))}
      <span className="gsw-sr-only">Loading messages</span>
    </div>
  );
}

export function CalendarEventSkeleton({ compact = true }: { compact?: boolean }) {
  return (
    <div className={compact ? "gsw-calendar-event-skeleton compact" : "gsw-calendar-event-skeleton"} aria-hidden="true">
      <span className="gsw-skeleton gsw-calendar-skeleton-time" />
      <span className="gsw-skeleton gsw-calendar-skeleton-title" />
      {!compact && <span className="gsw-skeleton gsw-calendar-skeleton-detail" />}
    </div>
  );
}
