import assert from 'node:assert/strict';
import { meetingMinutes, positionMeetings, calendarViewDays, normalizeCalendarView } from '../src/calendarLayout.ts';
const day = '2026-10-27';
const meeting = (id, start, end) => ({ id, start: { dateTime: `${day}T${start}:00Z` }, end: { dateTime: `${day}T${end}:00Z` } });
const events = [meeting('opening','09:00','09:30'), meeting('overlap','09:15','10:15'), meeting('adjacent','09:30','09:35'), meeting('later','13:00','14:00'), meeting('ending','17:50','18:00'), meeting('six','18:00','18:30')];
function verify(entries, height) {
  for (const entry of entries) {
    assert(entry.height > 0 && entry.top >= 0 && entry.top + entry.height <= height + .001);
    assert(entry.lane >= 0 && entry.lane + entry.laneSpan <= entry.laneCount);
  }
  for (const a of entries) for (const b of entries) {
    if (a === b || a.top + a.height <= b.top || b.top + b.height <= a.top) continue;
    assert((a.lane + a.laneSpan) / a.laneCount <= b.lane / b.laneCount || (b.lane + b.laneSpan) / b.laneCount <= a.lane / a.laneCount, `${a.event.id} overlaps ${b.event.id}`);
  }
}
for (const height of [1, 24, 40, 80, 180, 350, 700]) {
  const entries = positionMeetings(events, day, 'UTC', height);
  assert.equal(entries.length, events.length, 'all workday meetings, including 6 PM, remain present');
  verify(entries, height);
}
const overnight = { id:'overnight', start:{dateTime:'2026-10-26T23:00:00Z'}, end:{dateTime:'2026-10-27T09:30:00Z'} };
assert.deepEqual(meetingMinutes(overnight, day, 'UTC'), { start:0, end:570 });
assert.equal(meetingMinutes({ ...overnight, end:{dateTime:'2026-10-27T00:00:00Z'} }, day, 'UTC'), null);
assert.deepEqual(meetingMinutes(meeting('zone','00:30','01:00'), '2026-10-26', 'America/New_York'), { start:1230, end:1260 });
let seed = 13;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let batch = 0; batch < 100; batch++) {
  const randomEvents = Array.from({length:40}, (_, id) => {
    const start = Math.floor(540 + random() * 540);
    const end = Math.min(1439, start + Math.ceil(random() * 180));
    const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
    return meeting(String(id), time(start), time(end));
  });
  const height = 24 + random() * 600;
  verify(positionMeetings(randomEvents, day, 'UTC', height), height);
}
console.log('Calendar workday, clipping, timezone, midnight, and collision checks passed');

for(const date of [new Date(2026,9,28),new Date(2026,10,1),new Date(2026,11,31)]){
  const work=calendarViewDays(date,'work');
  assert.deepEqual(work.map(day=>day.getDay()),[1,2,3,4,5]);
  assert(work.every(day=>day.getHours()===0));
  assert.equal(calendarViewDays(date,'week').length,7);
  assert.equal(calendarViewDays(date,'day')[0].getDate(),date.getDate());
}
assert.deepEqual(calendarViewDays(new Date(2026,10,1),'work').map(day=>day.getDate()),[26,27,28,29,30]);
assert.equal(normalizeCalendarView('work'),'work');
assert.equal(normalizeCalendarView(undefined),'week');
assert.equal(positionMeetings(events,day,'UTC',180,540,1080,false).some(entry=>entry.event.id==='six'),false);
assert(positionMeetings(events,day,'UTC',180,540,1080,false).some(entry=>entry.event.id==='ending'));
console.log('Work mode weekdays, Sunday/year boundaries and strict working-hour endpoint passed');
