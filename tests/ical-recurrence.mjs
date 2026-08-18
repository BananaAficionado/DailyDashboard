import assert from "node:assert/strict";
import { expandIcalRecurrence } from "../src/icalRecurrence.ts";

const dateTime = (value) => ({ dateTime: value, timeZone: "Australia/Melbourne" });
const windowStart = new Date("2026-08-09T00:00:00");
const windowEnd = new Date("2026-08-18T00:00:00");

const outlookWeekly = expandIcalRecurrence({
  start: dateTime("2026-08-03T09:00:00"),
  end: dateTime("2026-08-03T09:30:00"),
  rrule: "FREQ=WEEKLY;UNTIL=20260901T135959Z;INTERVAL=1;BYDAY=MO,WE;WKST=SU",
  windowStart,
  windowEnd,
});
assert.deepEqual(
  outlookWeekly.map((occurrence) => occurrence.start.dateTime),
  ["2026-08-10T09:00:00", "2026-08-12T09:00:00", "2026-08-17T09:00:00"],
  "Outlook weekly RRULE expands each weekday in the visible window"
);

const withExceptionDate = expandIcalRecurrence({
  start: dateTime("2026-08-03T09:00:00"),
  end: dateTime("2026-08-03T09:30:00"),
  rrule: "FREQ=WEEKLY;COUNT=6;BYDAY=MO,WE",
  exdates: [dateTime("2026-08-12T09:00:00")],
  windowStart,
  windowEnd,
});
assert.deepEqual(
  withExceptionDate.map((occurrence) => occurrence.start.dateTime),
  ["2026-08-10T09:00:00", "2026-08-17T09:00:00"],
  "EXDATE removes one generated Outlook occurrence while COUNT is applied to the complete series"
);

const monthlySecondThursday = expandIcalRecurrence({
  start: dateTime("2026-01-08T14:00:00"),
  end: dateTime("2026-01-08T15:00:00"),
  rrule: "FREQ=MONTHLY;INTERVAL=1;BYDAY=TH;BYSETPOS=2",
  windowStart: new Date("2026-08-01T00:00:00"),
  windowEnd: new Date("2026-10-01T00:00:00"),
});
assert.deepEqual(
  monthlySecondThursday.map((occurrence) => occurrence.start.dateTime),
  ["2026-08-13T14:00:00", "2026-09-10T14:00:00"],
  "Outlook monthly BYDAY/BYSETPOS rules expand to the requested ordinal weekday"
);

const allDayDaily = expandIcalRecurrence({
  start: { date: "2026-08-09" },
  end: { date: "2026-08-10" },
  rrule: "FREQ=DAILY;COUNT=3",
  windowStart,
  windowEnd,
});
assert.deepEqual(
  allDayDaily.map((occurrence) => [occurrence.start.date, occurrence.end.date]),
  [["2026-08-09", "2026-08-10"], ["2026-08-10", "2026-08-11"], ["2026-08-11", "2026-08-12"]],
  "all-day recurrence preserves its duration"
);

const utcWeekly = expandIcalRecurrence({
  start: { dateTime: "2026-08-03T23:30:00Z" },
  end: { dateTime: "2026-08-04T00:00:00Z" },
  rrule: "FREQ=WEEKLY;COUNT=3;BYDAY=MO",
  windowStart: new Date("2026-08-01T00:00:00"),
  windowEnd: new Date("2026-08-25T00:00:00"),
});
assert.deepEqual(
  utcWeekly.map((occurrence) => [occurrence.start.dateTime, occurrence.end.dateTime]),
  [
    ["2026-08-03T23:30:00Z", "2026-08-04T00:00:00Z"],
    ["2026-08-10T23:30:00Z", "2026-08-11T00:00:00Z"],
    ["2026-08-17T23:30:00Z", "2026-08-18T00:00:00Z"],
  ],
  "UTC recurring meetings retain their UTC wall time and duration"
);

console.log("iCalendar recurrence checks passed");
