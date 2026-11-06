import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CalendarHoverPreview } from './CalendarHoverPreview';
import { ChevronDown } from 'lucide-react';
import { meetingMinutes, positionMeetings, type CalendarEntry } from './calendarLayout';

const dayKey = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const formatTime = (value: string | undefined, timeZone: string) => value ? new Date(value).toLocaleTimeString([], { timeZone, hour: 'numeric', minute: '2-digit' }) : 'All day';

export function CalendarTimeline<T extends CalendarEntry>({ days, events, timeZone, now, selectedId, onSelect, workMode = false }: {
  days: Date[]; events: T[]; timeZone: string; now: Date; selectedId: string | null; workMode?: boolean; onSelect: (id: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(240);
  const [fullDay, setFullDay] = useState(false);
  const [hover, setHover] = useState<{id: string; anchor: HTMLElement} | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelTimers = () => { clearTimeout(showTimer.current); clearTimeout(closeTimer.current); };
  const hidePreview = () => { cancelTimers(); setHover(null); };
  const showPreview = (id: string, anchor: HTMLElement) => { cancelTimers(); if (!selectedId) showTimer.current = setTimeout(() => setHover({id, anchor}), 220); };
  const leavePreview = () => { clearTimeout(showTimer.current); clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setHover(null), 180); };
  const selectEvent = (id: string) => { hidePreview(); onSelect(id); };
  useEffect(() => { hidePreview(); return cancelTimers; }, [days, selectedId]);
  const previewEvent = !selectedId && hover ? events.find(event => event.id === hover.id) : undefined;
  const showFullDay = fullDay && !workMode;
  const startHour = showFullDay ? 0 : 9;
  const endHour = showFullDay ? 24 : 18;
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const resize = (entries: ResizeObserverEntry[]) => setHeight(Math.max(1, (entries[0]?.contentRect.height ?? body.clientHeight) - .5));
    resize([]);
    const observer = new ResizeObserver(resize);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const currentMinute = nowParts[0] * 60 + nowParts[1];
  const allDayByDay = days.map(day => events.filter(event => event.start.date && dayKey(day) >= event.start.date && (event.end.date ? dayKey(day) < event.end.date : dayKey(day) === event.start.date)));
  const hasAllDay = allDayByDay.some(entries => entries.length);
  const positioned = useMemo(() => days.map(day => positionMeetings(events, dayKey(day), timeZone, height, startHour * 60, endHour * 60, !workMode)), [days, events, timeZone, height, startHour, endHour, workMode]);
  const outside = new Set(days.flatMap(day => events.filter(event => {
    const minutes = meetingMinutes(event, dayKey(day), timeZone);
    return minutes && (minutes.start < 540 || minutes.end > 1080);
  }).map(event => event.id))).size;
  const columns = `var(--calendar-gutter) repeat(${days.length}, minmax(0, 1fr))`;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => index + startHour);
  return (
    <div className={`calendar-scroll calendar-timeline ${hasAllDay ? 'has-all-day' : ''} ${height < 100 ? 'condensed-hours' : ''} ${height < 45 ? 'minimal-hours' : ''}`} onKeyDown={key => { if (key.key === 'Escape' && hover) { key.stopPropagation(); hidePreview(); } }} onPointerLeave={leavePreview} data-day-count={days.length} data-work-mode={workMode} data-start-hour={startHour} data-end-hour={endHour}>
      <div className="day-header" style={{ gridTemplateColumns: columns }}>
        <div className="timezone" title={timeZone} aria-label={timeZone} />
        {days.map(day => <div data-date={dayKey(day)} data-weekday={day.getDay()} className={`day-heading ${dayKey(day) === today ? 'is-today' : ''}`} key={dayKey(day)}><span>{day.toLocaleDateString([], { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}
      </div>
      {hasAllDay ? <div className="all-day-row" style={{ gridTemplateColumns: columns }}>
        <span className="all-day-label">All day</span>
        {allDayByDay.map((entries, index) => <div className="all-day-cell" style={{ "--all-day-count": entries.length || 1, gridTemplateColumns: `repeat(${entries.length <= 2 ? Math.max(1, entries.length) : Math.ceil(entries.length / 2)}, minmax(0, 1fr))` } as CSSProperties} key={dayKey(days[index])}>{entries.map(event => <button key={event.id} data-event-id={event.id} className="event-pill" style={{ '--event-color': event.calendarColor || 'var(--blue)' } as CSSProperties} aria-label={event.summary || 'Untitled event'} aria-describedby={hover?.id === event.id ? 'calendar-hover-preview' : undefined} onPointerEnter={e => { if (e.pointerType !== 'touch') showPreview(event.id, e.currentTarget); }} onPointerLeave={leavePreview} onFocus={e => showPreview(event.id, e.currentTarget)} onBlur={leavePreview} onClick={() => selectEvent(event.id)}>{event.summary || 'Untitled'}</button>)}</div>)}
      </div> : null}
      <div ref={bodyRef} className="time-grid" style={{ gridTemplateColumns: columns, '--calendar-hour-height': `${height / (endHour - startHour)}px` } as CSSProperties}>
        <div className="time-gutter">{hours.map(hour => <span key={hour} data-major={hour % 3 === 0 ? "true" : undefined} className={`time-label ${hour === startHour ? 'first' : ''} ${hour === endHour ? 'last' : ''}`} style={{ top: `${(hour - startHour) / (endHour - startHour) * 100}%` }}>{hour === 24 || hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : `${hour % 12} ${hour < 12 ? 'AM' : 'PM'}`}</span>)}</div>
        {days.map((day, index) => <div className={`day-column ${dayKey(day) === today ? 'is-today' : ''}`} style={{ gridColumn: index + 2 }} key={dayKey(day)}>
          {dayKey(day) === today && currentMinute >= startHour * 60 && currentMinute <= endHour * 60 ? <div className="current-time-marker" aria-label="Current time" style={{ top: `${(currentMinute / 60 - startHour) / (endHour - startHour) * 100}%` }}><span /></div> : null}
          {positioned[index].map(({ event, top, height: cardHeight, lane, laneCount, laneSpan, startMinute, endMinute }) => <button key={event.id}
            className={`timed-event ${cardHeight >= 32 ? 'long' : 'short'} ${event.id === selectedId ? 'expanded' : ''}`}
            data-event-id={event.id} data-start-minute={startMinute} data-end-minute={endMinute}
            style={{ top, height: cardHeight, left: `calc(${lane / laneCount * 100}% + min(1px, ${5 / laneCount}%))`, width: `calc(${laneSpan / laneCount * 100}% - min(2px, ${10 / laneCount}%))`, '--event-color': event.calendarColor || 'var(--blue)' } as CSSProperties}
            aria-label={`${event.summary || 'Untitled event'}, ${formatTime(event.start.dateTime, timeZone)} to ${formatTime(event.end.dateTime, timeZone)}`} aria-expanded={event.id === selectedId} aria-describedby={hover?.id === event.id ? 'calendar-hover-preview' : undefined} onPointerEnter={e => { if (e.pointerType !== 'touch') showPreview(event.id, e.currentTarget); }} onPointerLeave={leavePreview} onFocus={e => showPreview(event.id, e.currentTarget)} onBlur={leavePreview} onClick={() => selectEvent(event.id)}>
            <strong>{event.summary || 'Untitled'}</strong><span>{formatTime(event.start.dateTime, timeZone)}{event.location ? ` · ${event.location}` : ''}</span>
          </button>)}
        </div>)}
      </div>
      {!workMode ? <div className="calendar-workday-footer"><button title={showFullDay ? 'Fit working hours' : `${outside} events outside working hours. Show all 24 hours`} aria-pressed={showFullDay} onClick={() => setFullDay(value => !value)}>{showFullDay ? 'Working hours' : outside ? `${outside} outside` : 'Full day'}<ChevronDown size={12} /></button></div> : null}
      {/* Keep the backdrop mounted so dismissal can finish its fade. */}
      <div className="calendar-hover-backdrop" data-visible={Boolean(previewEvent && hover)} aria-hidden="true" />
      {previewEvent && hover ? <CalendarHoverPreview event={previewEvent} anchor={hover.anchor} timeZone={timeZone} onKeep={cancelTimers} onLeave={leavePreview} /> : null}
    </div>
  );
}
