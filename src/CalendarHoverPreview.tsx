import { useLayoutEffect, useRef, useState } from 'react';
import type { CalendarEntry } from './calendarLayout';
export function CalendarHoverPreview({ event, anchor, timeZone, onKeep, onLeave }: { event: CalendarEntry; anchor: HTMLElement; timeZone: string; onKeep: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const popup = ref.current, container = anchor.closest('.calendar-timeline') as HTMLElement | null;
    if (!popup || !container) return;
    const update = () => {
      const parent = container.getBoundingClientRect(), target = anchor.getBoundingClientRect();
      const zoom = parent.width / Math.max(1, container.offsetWidth);
      let left = (target.right - parent.left) / zoom + 8;
      if (left + popup.offsetWidth > container.clientWidth - 8) left = (target.left - parent.left) / zoom - popup.offsetWidth - 8;
      setPosition({ left: Math.max(8, Math.min(left, container.clientWidth - popup.offsetWidth - 8)), top: Math.max(8, Math.min((target.top - parent.top) / zoom, container.clientHeight - popup.offsetHeight - 8)) });
    };
    update(); const observer = new ResizeObserver(update); observer.observe(container); observer.observe(popup);
    return () => observer.disconnect();
  }, [anchor, event.id]);
  const date = new Date(event.start.dateTime || `${event.start.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(event.start.dateTime ? {timeZone} : {}) });
  const time = (value?: string) => value ? new Date(value).toLocaleTimeString([], {timeZone, hour:'numeric',minute:'2-digit'}) : '';
  return <section ref={ref} id="calendar-hover-preview" className="calendar-hover-preview" role="tooltip" style={position} onPointerEnter={onKeep} onPointerLeave={onLeave}>
      {event.calendarSummary ? <small>{event.calendarSummary}</small> : null}
      <h3>{event.summary || 'Untitled event'}</h3>
      <p>{date}<br />{event.start.dateTime ? `${time(event.start.dateTime)} – ${time(event.end.dateTime)}` : 'All day'}</p>
      {event.location ? <p className="calendar-preview-location">{event.location}</p> : null}
    </section>;
}
