import { ChevronDown, Clock3, MapPin, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type ClockWidgetSize = "full" | "wide" | "tall" | "half";
export type ClockFaceMode = "analog" | "digital";

export type ClockAgendaItem = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  calendarName?: string;
  organizer?: string;
  attendees?: string[];
  startDate?: string;
  startDateTime?: string;
  endDate?: string;
  endDateTime?: string;
  color?: string;
};

type ClockWidgetProps = {
  size: ClockWidgetSize;
  timeZone?: string;
  faceMode?: ClockFaceMode;
  agenda: ClockAgendaItem[];
  onTimeZoneChange: (timeZone: string) => void;
  onFaceModeChange: (faceMode: ClockFaceMode) => void;
  onClose: () => void;
};

const TIME_ZONES = [
  ["system", "System time"], ["UTC", "UTC"], ["Pacific/Auckland", "Auckland"],
  ["Australia/Melbourne", "Melbourne"], ["Australia/Sydney", "Sydney"], ["Australia/Brisbane", "Brisbane"],
  ["Australia/Adelaide", "Adelaide"], ["Australia/Perth", "Perth"], ["Asia/Tokyo", "Tokyo"],
  ["Asia/Singapore", "Singapore"], ["Asia/Kolkata", "Delhi / Kolkata"], ["Asia/Dubai", "Dubai"],
  ["Europe/London", "London"], ["Europe/Paris", "Paris"], ["America/New_York", "New York"],
  ["America/Chicago", "Chicago"], ["America/Denver", "Denver"], ["America/Los_Angeles", "Los Angeles"],
  ["Pacific/Honolulu", "Honolulu"],
] as const;

export function ClockWidget({ size, timeZone = "system", faceMode, agenda, onTimeZoneChange, onFaceModeChange, onClose }: ClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const [timeZoneOpen, setTimeZoneOpen] = useState(false);
  const [selectedAgendaItem, setSelectedAgendaItem] = useState<ClockAgendaItem | null>(null);
  const [detailsClosing, setDetailsClosing] = useState(false);
  const resolvedTimeZone = timeZone === "system" ? undefined : timeZone;
  const resolvedFaceMode = faceMode || (size === "tall" || size === "half" ? "analog" : "digital");
  const analog = resolvedFaceMode === "analog";
  const showAgenda = size !== "tall";

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!detailsClosing) return;
    const timer = window.setTimeout(() => {
      setSelectedAgendaItem(null);
      setDetailsClosing(false);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [detailsClosing]);

  const parts = useMemo(() => clockParts(now, resolvedTimeZone), [now, resolvedTimeZone]);
  const todayAgenda = useMemo(
    () => agenda
      .filter((item) => agendaDateKey(item, resolvedTimeZone) === parts.dateKey)
      .sort((left, right) => agendaSortValue(left) - agendaSortValue(right)),
    [agenda, parts.dateKey, resolvedTimeZone]
  );
  const zoneLabel = TIME_ZONES.find(([value]) => value === timeZone)?.[1] || timeZone.replace(/_/g, " ");

  return (
    <section className={`clock-widget clock-widget-${size} ${analog ? "clock-analog-mode" : "clock-digital-mode"}`}>
      <header className="clock-widget-header">
        <div className="clock-widget-title"><Clock3 size={17} /><strong>Clock</strong></div>
        <div className="clock-widget-actions">
          <div className="clock-face-toggle" aria-label="Clock face">
            <button className={analog ? "active" : ""} aria-pressed={analog} onClick={() => onFaceModeChange("analog")} title="Analog clock">A</button>
            <button className={!analog ? "active" : ""} aria-pressed={!analog} onClick={() => onFaceModeChange("digital")} title="Digital clock">D</button>
          </div>
          <button className="clock-zone-button" onClick={() => setTimeZoneOpen((open) => !open)} aria-expanded={timeZoneOpen} title="Change timezone">
            <span>{zoneLabel}</span><ChevronDown size={14} />
          </button>
          <button className="icon-button" onClick={onClose} title="Hide Clock"><X size={17} /></button>
        </div>
      </header>

      {timeZoneOpen ? (
        <div className="clock-zone-popover" role="dialog" aria-label="Choose timezone">
          <span>Timezone</span>
          <div className="clock-zone-options" role="listbox" tabIndex={0} onWheel={(event) => event.stopPropagation()}>
            {TIME_ZONES.map(([value, label]) => (
              <button
                key={value}
                className={value === timeZone ? "selected" : ""}
                role="option"
                aria-selected={value === timeZone}
                onClick={() => { onTimeZoneChange(value); setTimeZoneOpen(false); }}
              >{label}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={`clock-widget-body ${selectedAgendaItem && !detailsClosing ? "details-open" : ""}`}>
        {analog ? <AnalogClock parts={parts} /> : <DigitalClock parts={parts} />}
        {showAgenda ? (
          <div className={`clock-side-pane ${selectedAgendaItem ? "has-details" : ""} ${detailsClosing ? "details-closing" : ""}`}>
            <ClockAgenda items={todayAgenda} timeZone={resolvedTimeZone} compact={size === "half"} onSelect={(item) => { setDetailsClosing(false); setSelectedAgendaItem(item); }} />
            {selectedAgendaItem ? <AgendaDetails item={selectedAgendaItem} timeZone={resolvedTimeZone} onClose={() => setDetailsClosing(true)} /> : null}
          </div>
        ) : null}
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
        {Array.from({ length: 60 }, (_, index) => <i key={index} className={index % 5 === 0 ? "hour-tick" : "minute-tick"} style={{ transform: `rotate(${index * 6}deg)` }} />)}
        {Array.from({ length: 12 }, (_, index) => {
          const number = index + 1;
          const angle = number * Math.PI / 6;
          return <span key={number} className="clock-number" style={{ left: `${50 + Math.sin(angle) * 39}%`, top: `${50 - Math.cos(angle) * 39}%` }}>{number}</span>;
        })}
        <span className="clock-hand hour-hand" style={{ transform: `translateX(-50%) rotate(${hourDegrees}deg)` }} />
        <span className="clock-hand minute-hand" style={{ transform: `translateX(-50%) rotate(${minuteDegrees}deg)` }} />
        <span className="clock-hand second-hand" style={{ transform: `translateX(-50%) rotate(${secondDegrees}deg)` }} />
        <span className="clock-pin" />
      </div>
      <div className="analog-clock-caption"><strong>{parts.weekday}</strong><span>{parts.dateLabel}</span></div>
    </div>
  );
}

function DigitalClock({ parts }: { parts: ReturnType<typeof clockParts> }) {
  return (
    <div className="digital-clock" aria-label={`Digital clock showing ${parts.displayTime}`}>
      <div className="digital-time"><span>{parts.hourText}</span><b>:</b><span>{parts.minuteText}</span><small>{String(parts.second).padStart(2, "0")}</small></div>
      <div className="digital-date"><strong>{parts.weekday}</strong><span>{parts.dateLabel}</span></div>
    </div>
  );
}

function ClockAgenda({ items, timeZone, compact, onSelect }: { items: ClockAgendaItem[]; timeZone?: string; compact: boolean; onSelect: (item: ClockAgendaItem) => void }) {
  return (
    <aside className={`clock-agenda ${compact ? "compact" : ""}`}>
      <div className="clock-agenda-heading"><span>Today</span><small>{items.length} {items.length === 1 ? "item" : "items"}</small></div>
      <div className="clock-agenda-list">
        {items.length ? items.map((item) => (
          <button className="clock-agenda-item" key={item.id} onClick={() => onSelect(item)} title="Show event details">
            <i style={{ background: item.color || "#8ab4f8" }} />
            <div><strong>{item.title}</strong><span>{formatAgendaTime(item, timeZone)}</span></div>
          </button>
        )) : <p className="clock-agenda-empty">Nothing scheduled today</p>}
      </div>
    </aside>
  );
}

function AgendaDetails({ item, timeZone, onClose }: { item: ClockAgendaItem; timeZone?: string; onClose: () => void }) {
  return (
    <article className="clock-agenda-details" role="dialog" aria-label={`${item.title} details`}>
      <header><i style={{ background: item.color || "#8ab4f8" }} /><strong>{item.title}</strong><button className="icon-button" onClick={onClose} title="Close details"><X size={17} /></button></header>
      <div className="clock-agenda-details-body">
        <span>{formatAgendaRange(item, timeZone)}</span>
        {item.location ? <span><MapPin size={14} />{item.location}</span> : null}
        {item.calendarName ? <span>Calendar: {item.calendarName}</span> : null}
        {item.organizer ? <span>Organiser: {item.organizer}</span> : null}
        {item.attendees?.length ? <span>Attendees: {item.attendees.join(", ")}</span> : null}
        {item.description ? <p>{stripEventHtml(item.description)}</p> : null}
      </div>
    </article>
  );
}

function clockParts(date: Date, timeZone?: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(values.hour), minute = Number(values.minute), second = Number(values.second);
  return { hour, minute, second, millisecond: date.getMilliseconds(), hourText: values.hour.padStart(2, "0"), minuteText: values.minute.padStart(2, "0"), weekday: values.weekday, dateLabel: new Intl.DateTimeFormat(undefined, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(date), dateKey: `${values.year}-${values.month}-${values.day}`, displayTime: `${values.hour}:${values.minute}:${String(second).padStart(2, "0")}` };
}

function agendaDateKey(item: ClockAgendaItem, timeZone?: string) {
  if (item.startDate) return item.startDate;
  if (!item.startDateTime) return "";
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(item.startDateTime)).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function agendaSortValue(item: ClockAgendaItem) { return item.startDateTime ? new Date(item.startDateTime).getTime() : Number.MIN_SAFE_INTEGER; }

function formatAgendaTime(item: ClockAgendaItem, timeZone?: string) {
  if (item.startDate) return "All day";
  if (!item.startDateTime) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(item.startDateTime));
}

function formatAgendaRange(item: ClockAgendaItem, timeZone?: string) {
  if (item.startDate) return `All day · ${new Intl.DateTimeFormat(undefined, { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${item.startDate}T12:00:00`))}`;
  if (!item.startDateTime) return "Time unavailable";
  const date = new Intl.DateTimeFormat(undefined, { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(item.startDateTime));
  const start = formatAgendaTime(item, timeZone);
  const end = item.endDateTime ? new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(item.endDateTime)) : null;
  return `${date} · ${start}${end ? ` – ${end}` : ""}`;
}

function stripEventHtml(value: string) {
  const container = document.createElement("div");
  container.innerHTML = value;
  return container.textContent?.trim() || value;
}
