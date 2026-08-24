import { ChevronDown, Clock3, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type ClockWidgetSize = "full" | "wide" | "tall" | "half";

export type ClockAgendaItem = {
  id: string;
  title: string;
  startDate?: string;
  startDateTime?: string;
  color?: string;
};

type ClockWidgetProps = {
  size: ClockWidgetSize;
  timeZone?: string;
  agenda: ClockAgendaItem[];
  onTimeZoneChange: (timeZone: string) => void;
  onClose: () => void;
};

const TIME_ZONES = [
  ["system", "System time"],
  ["UTC", "UTC"],
  ["Pacific/Auckland", "Auckland"],
  ["Australia/Melbourne", "Melbourne"],
  ["Australia/Sydney", "Sydney"],
  ["Australia/Brisbane", "Brisbane"],
  ["Australia/Adelaide", "Adelaide"],
  ["Australia/Perth", "Perth"],
  ["Asia/Tokyo", "Tokyo"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Kolkata", "Delhi / Kolkata"],
  ["Asia/Dubai", "Dubai"],
  ["Europe/London", "London"],
  ["Europe/Paris", "Paris"],
  ["America/New_York", "New York"],
  ["America/Chicago", "Chicago"],
  ["America/Denver", "Denver"],
  ["America/Los_Angeles", "Los Angeles"],
  ["Pacific/Honolulu", "Honolulu"],
] as const;

export function ClockWidget({ size, timeZone = "system", agenda, onTimeZoneChange, onClose }: ClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const [timeZoneOpen, setTimeZoneOpen] = useState(false);
  const resolvedTimeZone = timeZone === "system" ? undefined : timeZone;
  const analog = size === "tall" || size === "half";
  const showAgenda = size === "full" || size === "half";

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, []);

  const parts = useMemo(() => clockParts(now, resolvedTimeZone), [now, resolvedTimeZone]);
  const todayAgenda = useMemo(
    () => agenda
      .filter((item) => agendaDateKey(item, resolvedTimeZone) === parts.dateKey)
      .sort((left, right) => agendaSortValue(left) - agendaSortValue(right))
      .slice(0, size === "half" ? 3 : 7),
    [agenda, parts.dateKey, resolvedTimeZone, size]
  );
  const zoneLabel = TIME_ZONES.find(([value]) => value === timeZone)?.[1] || timeZone.replace(/_/g, " ");

  return (
    <section className={`clock-widget clock-widget-${size} ${analog ? "clock-analog-mode" : "clock-digital-mode"}`}>
      <header className="clock-widget-header">
        <div>
          <Clock3 size={17} />
          <strong>Clock</strong>
        </div>
        <div className="clock-widget-actions">
          <button className="clock-zone-button" onClick={() => setTimeZoneOpen((open) => !open)} aria-expanded={timeZoneOpen} title="Change timezone">
            <span>{zoneLabel}</span>
            <ChevronDown size={14} />
          </button>
          <button className="icon-button" onClick={onClose} title="Hide Clock"><X size={17} /></button>
        </div>
      </header>

      {timeZoneOpen ? (
        <div className="clock-zone-popover">
          <label htmlFor={`clock-time-zone-${size}`}>Timezone</label>
          <select
            id={`clock-time-zone-${size}`}
            value={timeZone}
            onChange={(event) => {
              onTimeZoneChange(event.target.value);
              setTimeZoneOpen(false);
            }}
          >
            {TIME_ZONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      ) : null}

      <div className="clock-widget-body">
        {analog ? <AnalogClock parts={parts} /> : <DigitalClock now={now} timeZone={resolvedTimeZone} parts={parts} />}
        {showAgenda ? <ClockAgenda items={todayAgenda} timeZone={resolvedTimeZone} compact={size === "half"} /> : null}
      </div>
    </section>
  );
}

function AnalogClock({ parts }: { parts: ReturnType<typeof clockParts> }) {
  const hourDegrees = (parts.hour % 12) * 30 + parts.minute * 0.5 + parts.second * (0.5 / 60);
  const minuteDegrees = parts.minute * 6 + parts.second * 0.1;
  const secondDegrees = parts.second * 6 + parts.millisecond * 0.006;
  return (
    <div className="analog-clock-wrap">
      <div className="analog-clock" aria-label={`Analog clock showing ${parts.displayTime}`}>
        {Array.from({ length: 60 }, (_, index) => (
          <i key={index} className={index % 5 === 0 ? "hour-tick" : "minute-tick"} style={{ transform: `rotate(${index * 6}deg)` }} />
        ))}
        <span className="clock-number clock-number-12">12</span>
        <span className="clock-number clock-number-3">3</span>
        <span className="clock-number clock-number-6">6</span>
        <span className="clock-number clock-number-9">9</span>
        <span className="clock-hand hour-hand" style={{ transform: `translateX(-50%) rotate(${hourDegrees}deg)` }} />
        <span className="clock-hand minute-hand" style={{ transform: `translateX(-50%) rotate(${minuteDegrees}deg)` }} />
        <span className="clock-hand second-hand" style={{ transform: `translateX(-50%) rotate(${secondDegrees}deg)` }} />
        <span className="clock-pin" />
      </div>
      <div className="analog-clock-caption">
        <strong>{parts.weekday}</strong>
        <span>{parts.dateLabel}</span>
      </div>
    </div>
  );
}

function DigitalClock({ now, timeZone, parts }: { now: Date; timeZone?: string; parts: ReturnType<typeof clockParts> }) {
  const seconds = new Intl.DateTimeFormat(undefined, { second: "2-digit", timeZone }).format(now);
  return (
    <div className="digital-clock" aria-label={`Digital clock showing ${parts.displayTime}`}>
      <div className="digital-time"><span>{parts.hourText}</span><b>:</b><span>{parts.minuteText}</span><small>{seconds}</small></div>
      <div className="digital-date"><strong>{parts.weekday}</strong><span>{parts.dateLabel}</span></div>
    </div>
  );
}

function ClockAgenda({ items, timeZone, compact }: { items: ClockAgendaItem[]; timeZone?: string; compact: boolean }) {
  return (
    <aside className={`clock-agenda ${compact ? "compact" : ""}`}>
      <div className="clock-agenda-heading"><span>Today</span><small>{items.length} {items.length === 1 ? "item" : "items"}</small></div>
      <div className="clock-agenda-list">
        {items.length ? items.map((item) => (
          <div className="clock-agenda-item" key={item.id}>
            <i style={{ background: item.color || "#8ab4f8" }} />
            <div><strong>{item.title}</strong><span>{formatAgendaTime(item, timeZone)}</span></div>
          </div>
        )) : <p className="clock-agenda-empty">Nothing scheduled today</p>}
      </div>
    </aside>
  );
}

function clockParts(date: Date, timeZone?: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);
  return {
    hour,
    minute,
    second,
    millisecond: date.getMilliseconds(),
    hourText: values.hour,
    minuteText: values.minute,
    weekday: values.weekday,
    dateLabel: new Intl.DateTimeFormat(undefined, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(date),
    dateKey: `${values.year}-${values.month}-${values.day}`,
    displayTime: `${values.hour}:${values.minute}:${values.second}`,
  };
}

function agendaDateKey(item: ClockAgendaItem, timeZone?: string) {
  if (item.startDate) return item.startDate;
  if (!item.startDateTime) return "";
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(item.startDateTime)).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function agendaSortValue(item: ClockAgendaItem) {
  return item.startDateTime ? new Date(item.startDateTime).getTime() : Number.MIN_SAFE_INTEGER;
}

function formatAgendaTime(item: ClockAgendaItem, timeZone?: string) {
  if (item.startDate) return "All day";
  if (!item.startDateTime) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(item.startDateTime));
}
