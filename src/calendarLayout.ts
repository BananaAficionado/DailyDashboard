export type CalendarEntry = {
  id: string;
  summary?: string;
  calendarColor?: string;
  calendarSummary?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
};

export type PositionedMeeting<T extends CalendarEntry> = {
  event: T;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  laneSpan: number;
  startMinute: number;
  endMinute: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(value: string, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { key: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function meetingMinutes(event: CalendarEntry, dayKey: string, timeZone: string) {
  if (!event.start.dateTime) return null;
  const start = localParts(event.start.dateTime, timeZone);
  const end = localParts(event.end.dateTime || event.start.dateTime, timeZone);
  // End-exclusive day boundaries avoid phantom events at midnight on the next day.
  if (start.key > dayKey || end.key < dayKey || (end.key === dayKey && end.minute === 0 && start.key < dayKey)) return null;
  return { start: start.key < dayKey ? 0 : start.minute, end: end.key > dayKey ? 1440 : Math.max(end.minute, (start.key < dayKey ? 0 : start.minute) + 1) };
}

/** Lay out actual displayed rectangles, not just their uncompressed time intervals. */
export function positionMeetings<T extends CalendarEntry>(events: T[], dayKey: string, timeZone: string, height: number, startMinute = 540, endMinute = 1080, includeEndBoundary = true): PositionedMeeting<T>[] {
  const available = Math.max(1, height);
  const minimum = Math.min(18, Math.max(10, available / 12), available);
  const pixelsPerMinute = available / (endMinute - startMinute);
  const entries: PositionedMeeting<T>[] = [];
  for (const event of events) {
    const minutes = meetingMinutes(event, dayKey, timeZone);
    if (!minutes || minutes.end <= startMinute || minutes.start > endMinute || (!includeEndBoundary && minutes.start === endMinute)) continue;
    const duration = Math.max(1, (Math.min(endMinute, minutes.end) - Math.max(startMinute, minutes.start)) * pixelsPerMinute);
    const cardHeight = Math.min(available, Math.max(minimum, duration - 2));
    const top = Math.min(available - cardHeight, Math.max(0, (minutes.start - startMinute) * pixelsPerMinute));
    entries.push({ event, top, height: cardHeight, lane: 0, laneCount: 1, laneSpan: 1, startMinute: minutes.start, endMinute: minutes.end });
  }
  entries.sort((a, b) => a.top - b.top || b.height - a.height || a.event.id.localeCompare(b.event.id));
  let group: typeof entries = [];
  let laneEnds: number[] = [];
  const overlaps = (a: typeof entries[number], b: typeof entries[number]) => a.top < b.top + b.height + 1 && b.top < a.top + a.height + 1;
  const finishGroup = () => {
    for (const entry of group) {
      entry.laneCount = laneEnds.length;
      // An isolated part of an overlap group can reclaim unused columns, like Outlook/Google.
      for (let lane = entry.lane + 1; lane < laneEnds.length; lane++) {
        if (group.some(other => other.lane === lane && overlaps(entry, other))) break;
        entry.laneSpan++;
      }
    }
    group = [];
    laneEnds = [];
  };
  for (const entry of entries) {
    if (group.length && laneEnds.every(end => end + 1 <= entry.top)) finishGroup();
    const freeLane = laneEnds.findIndex(end => end + 1 <= entry.top);
    entry.lane = freeLane < 0 ? laneEnds.length : freeLane;
    laneEnds[entry.lane] = entry.top + entry.height;
    group.push(entry);
  }
  finishGroup();
  return entries;
}

export type CalendarViewMode = 'day' | 'work' | 'week';
export function normalizeCalendarView(value: unknown): CalendarViewMode {
  return value === 'day' || value === 'work' ? value : 'week';
}
export function calendarViewDays(date: Date, mode: CalendarViewMode): Date[] {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  if (mode === 'day') return [start];
  start.setDate(start.getDate() - (mode === 'work' ? (start.getDay() + 6) % 7 : start.getDay()));
  return Array.from({ length: mode === 'work' ? 5 : 7 }, (_, offset) => {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    return day;
  });
}
