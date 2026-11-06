export type IcalDateValue = { date?: string; dateTime?: string; timeZone?: string };

export type IcalOccurrence = {
  key: string;
  start: IcalDateValue;
  end: IcalDateValue;
};

type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
  byDay: string[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  weekStart: number;
};

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_MS = 86_400_000;

export function expandIcalRecurrence({
  start,
  end,
  rrule,
  exdates = [],
  windowStart,
  windowEnd,
}: {
  start: IcalDateValue;
  end: IcalDateValue;
  rrule?: string;
  exdates?: IcalDateValue[];
  windowStart: Date;
  windowEnd: Date;
}): IcalOccurrence[] {
  const first = toDate(start);
  const last = toDate(end);
  if (!first || !last) return [];
  const duration = Math.max(0, last.getTime() - first.getTime());
  const durationDays = start.date && end.date ? Math.max(0, calendarDayDiff(first, last)) : null;
  const excluded = new Set(exdates.map(icalDateKey));
  if (!rrule) {
    return overlapsWindow(first, last, windowStart, windowEnd) && !excluded.has(icalDateKey(start))
      ? [{ key: icalDateKey(start), start, end }]
      : [];
  }

  const rule = parseRule(rrule, first);
  if (!rule) return [];
  const occurrences: IcalOccurrence[] = [];
  const scanEnd = new Date(Math.min(windowEnd.getTime() + 370 * DAY_MS, rule.until?.getTime() ?? Number.MAX_SAFE_INTEGER));
  const cursor = new Date(first);
  cursor.setHours(0, 0, 0, 0);
  let matched = 0;
  let scanned = 0;

  while (cursor <= scanEnd && scanned < 50_000) {
    scanned += 1;
    if (matchesRule(cursor, first, rule)) {
      const occurrenceDate = withTime(cursor, first);
      if (rule.until && occurrenceDate > rule.until) break;
      matched += 1;
      if (rule.count && matched > rule.count) break;
      const occurrenceStart = fromDate(occurrenceDate, start);
      const occurrenceEndDate = durationDays == null
        ? new Date(occurrenceDate.getTime() + duration)
        : addCalendarDays(occurrenceDate, durationDays);
      const occurrenceEnd = fromDate(occurrenceEndDate, end);
      const key = icalDateKey(occurrenceStart);
      if (!excluded.has(key) && overlapsWindow(occurrenceDate, occurrenceEndDate, windowStart, windowEnd)) {
        occurrences.push({ key, start: occurrenceStart, end: occurrenceEnd });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return occurrences;
}

export function icalDateKey(value: IcalDateValue) {
  return value.date || value.dateTime || "";
}

function parseRule(value: string, first: Date): Rule | null {
  const parts = Object.fromEntries(value.split(";").map((item) => {
    const separator = item.indexOf("=");
    return separator > 0 ? [item.slice(0, separator).toUpperCase(), item.slice(separator + 1)] : [item.toUpperCase(), ""];
  }));
  const freq = parts.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const count = positiveInteger(parts.COUNT);
  return {
    freq,
    interval: positiveInteger(parts.INTERVAL) || 1,
    count: count || undefined,
    until: parseUntil(parts.UNTIL),
    byDay: splitList(parts.BYDAY),
    byMonthDay: splitList(parts.BYMONTHDAY).map(Number).filter((item) => Number.isInteger(item) && item !== 0),
    byMonth: splitList(parts.BYMONTH).map(Number).filter((item) => item >= 1 && item <= 12),
    bySetPos: splitList(parts.BYSETPOS).map(Number).filter((item) => Number.isInteger(item) && item !== 0),
    weekStart: Math.max(0, DAY_CODES.indexOf(parts.WKST || DAY_CODES[first.getDay()])),
  };
}

function matchesRule(candidate: Date, first: Date, rule: Rule) {
  if (candidate < startOfDate(first)) return false;
  const dayDiff = calendarDayDiff(startOfDate(first), candidate);
  const dayCode = DAY_CODES[candidate.getDay()];
  if (rule.byMonth.length && !rule.byMonth.includes(candidate.getMonth() + 1)) return false;

  if (rule.freq === "DAILY") {
    return dayDiff % rule.interval === 0 && (!rule.byDay.length || rule.byDay.some((item) => item.endsWith(dayCode)));
  }
  if (rule.freq === "WEEKLY") {
    const firstWeek = weekStart(first, rule.weekStart);
    const candidateWeek = weekStart(candidate, rule.weekStart);
    const weeks = Math.round(calendarDayDiff(firstWeek, candidateWeek) / 7);
    const allowedDays = rule.byDay.length ? rule.byDay.map(stripDayOrdinal) : [DAY_CODES[first.getDay()]];
    return weeks % rule.interval === 0 && allowedDays.includes(dayCode);
  }
  if (rule.freq === "MONTHLY") {
    const months = (candidate.getFullYear() - first.getFullYear()) * 12 + candidate.getMonth() - first.getMonth();
    if (months % rule.interval !== 0) return false;
    return matchesMonthDay(candidate, first, rule);
  }
  const years = candidate.getFullYear() - first.getFullYear();
  if (years % rule.interval !== 0) return false;
  if (rule.byMonthDay.length && !matchesNumericMonthDay(candidate, rule.byMonthDay)) return false;
  if (rule.byDay.length && !matchesByDay(candidate, rule.byDay, rule.bySetPos)) return false;
  if (rule.byMonthDay.length || rule.byDay.length) return true;
  return candidate.getDate() === first.getDate() && (rule.byMonth.length > 0 || candidate.getMonth() === first.getMonth());
}

function matchesMonthDay(candidate: Date, first: Date, rule: Rule) {
  if (rule.byMonthDay.length) return matchesNumericMonthDay(candidate, rule.byMonthDay);
  if (rule.byDay.length) return matchesByDay(candidate, rule.byDay, rule.bySetPos);
  return candidate.getDate() === first.getDate();
}

function matchesNumericMonthDay(candidate: Date, values: number[]) {
  const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
  return values.some((value) => candidate.getDate() === (value > 0 ? value : daysInMonth + value + 1));
}

function matchesByDay(candidate: Date, values: string[], setPositions: number[]) {
  const dayCode = DAY_CODES[candidate.getDay()];
  const matching = values.filter((value) => stripDayOrdinal(value) === dayCode);
  if (!matching.length) return false;
  if (!setPositions.length) {
    const ordinals = matching.map((value) => Number.parseInt(value.slice(0, -2), 10)).filter(Boolean);
    if (!ordinals.length) return true;
    const sameWeekdayDates = datesForWeekdaysInMonth(candidate.getFullYear(), candidate.getMonth(), [dayCode]);
    return ordinals.some((position) => {
      const index = position > 0 ? position - 1 : sameWeekdayDates.length + position;
      return sameWeekdayDates[index]?.getDate() === candidate.getDate();
    });
  }
  const days = datesForWeekdaysInMonth(candidate.getFullYear(), candidate.getMonth(), values.map(stripDayOrdinal));
  return setPositions.some((position) => {
    const index = position > 0 ? position - 1 : days.length + position;
    return days[index]?.getDate() === candidate.getDate();
  });
}

function datesForWeekdaysInMonth(year: number, month: number, days: string[]) {
  const result: Date[] = [];
  const cursor = new Date(year, month, 1);
  while (cursor.getMonth() === month) {
    if (days.includes(DAY_CODES[cursor.getDay()])) result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function parseUntil(value?: string) {
  if (!value) return undefined;
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999);
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dateTime) return undefined;
  return new Date(Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]), Number(dateTime[4]), Number(dateTime[5]), Number(dateTime[6]));
}

function toDate(value: IcalDateValue) {
  if (value.date) {
    const [year, month, day] = value.date.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (!value.dateTime) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value.dateTime);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])) : null;
}

function fromDate(value: Date, template: IcalDateValue): IcalDateValue {
  if (template.date) return { date: localDate(value) };
  if (template.dateTime?.endsWith("Z")) {
    const utc = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()));
    return { dateTime: utc.toISOString().replace(/\.\d{3}Z$/, "Z"), timeZone: template.timeZone };
  }
  return { dateTime: localDateTime(value), timeZone: template.timeZone };
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function localDateTime(value: Date) {
  return `${localDate(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function startOfDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function weekStart(value: Date, weekStartDay: number) {
  const result = startOfDate(value);
  result.setDate(result.getDate() - ((result.getDay() - weekStartDay + 7) % 7));
  return result;
}

function withTime(date: Date, time: Date) {
  const result = new Date(date);
  result.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
  return result;
}

function addCalendarDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDayDiff(a: Date, b: Date) {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

function overlapsWindow(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  return start < windowEnd && end >= windowStart;
}

function splitList(value?: string) {
  return value ? value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : [];
}

function stripDayOrdinal(value: string) {
  return value.slice(-2);
}

function positiveInteger(value?: string) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
