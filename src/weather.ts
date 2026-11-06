export type WeatherHour = { time: string; temp: number; feelsLike: number; precip: number; precipProbability?: number | null };
export type WeatherDay = {
  date: string;
  sunrise?: string;
  sunset?: string;
  minTemp: number;
  maxTemp: number;
  uvIndex: number;
  precipTotal: number;
  precipProbability: number;
  hourly: WeatherHour[];
};
export type WeatherData = {
  timezone?: string;
  currentTemp: number;
  feelsLikeTemp: number;
  minTemp: number;
  maxTemp: number;
  uvIndex: number;
  precipTotal: number;
  precipProbability: number;
  hourlyPrecip: { time: string; value: number }[];
  rainHistory: { time: string; value: number }[];
  days: WeatherDay[];
  alert: string;
};

export function weatherProbability(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : null;
}

export function buildWeatherDays(data: any): WeatherDay[] {
  const dates: string[] = data.daily?.time || [];
  return dates.slice(0, 5).map((date, dayIndex) => ({
    date,
    sunrise: data.daily?.sunrise?.[dayIndex],
    sunset: data.daily?.sunset?.[dayIndex],
    minTemp: Math.round(data.daily?.temperature_2m_min?.[dayIndex] ?? 0),
    maxTemp: Math.round(data.daily?.temperature_2m_max?.[dayIndex] ?? 0),
    uvIndex: Math.round(data.daily?.uv_index_max?.[dayIndex] ?? 0),
    precipTotal: Number(data.daily?.precipitation_sum?.[dayIndex] ?? 0),
    precipProbability: weatherProbability(data.daily?.precipitation_probability_max?.[dayIndex]) ?? 0,
    hourly: (data.hourly?.time || []).map((time: string, index: number) => ({
      time,
      temp: Number(data.hourly?.temperature_2m?.[index] ?? 0),
      feelsLike: Number(data.hourly?.apparent_temperature?.[index] ?? data.hourly?.temperature_2m?.[index] ?? 0),
      precip: Number(data.hourly?.precipitation?.[index] ?? 0),
      precipProbability: weatherProbability(data.hourly?.precipitation_probability?.[index]),
    })).filter((hour: WeatherHour) => hour.time.startsWith(date)),
  }));
}

// Open-Meteo's offset-free timestamps are already in the forecast location's
// local time. Never parse those in the computer's time zone and convert again.
export function weatherLocalTime(value: Date | string, timeZone?: string): { date: string; minutes: number } | null {
  if (typeof value === 'string') {
    const wall = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (wall) {
      const hour = Number(wall[2]), minute = Number(wall[3]);
      return hour < 24 && minute < 60 ? { date: wall[1], minutes: hour * 60 + minute } : null;
    }
  }
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return { date: `${part('year')}-${part('month')}-${part('day')}`, minutes: Number(part('hour')) * 60 + Number(part('minute')) };
  } catch { return null; }
}

export function formatWeatherTime(value?: string, timeZone?: string, hourOnly = false): string {
  const local = value ? weatherLocalTime(value, timeZone) : null;
  return local ? new Date(Date.UTC(2000, 0, 1, 0, local.minutes)).toLocaleTimeString([], { timeZone: 'UTC', hour: 'numeric', ...(hourOnly ? {} : { minute: '2-digit' }) }) : 'Unavailable';
}

export function weatherHourIndex(clientX: number, left: number, width: number, count: number): number | null {
  return count > 0 && width > 0 ? Math.round(Math.max(0, Math.min(1, (clientX - left) / width)) * (count - 1)) : null;
}

export function weatherSolarState(day: Pick<WeatherDay, 'date' | 'sunrise' | 'sunset'> | undefined, now: Date, timeZone?: string) {
  const local = weatherLocalTime(now, timeZone);
  const rise = day?.sunrise ? weatherLocalTime(day.sunrise, timeZone) : null;
  const set = day?.sunset ? weatherLocalTime(day.sunset, timeZone) : null;
  const unknown = { phase: 'unknown', night: 0, dawn: 0, dusk: 0, position: null as { x: number; y: number; aboveHorizon: boolean } | null };
  if (!day || !local || local.date !== day.date || rise?.date !== day.date || set?.date !== day.date || set.minutes <= rise.minutes) return unknown;
  const minute = local.minutes;
  // A 90-minute transition surrounds each solar event; the strongest warm
  // colour is at sunrise/sunset, fading into the existing daytime palette.
  const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  const transitionMinutes = Math.min(45, (set.minutes - rise.minutes) / 4, (1440 - set.minutes + rise.minutes) / 4);
  const night = Math.max(1 - smooth((minute - rise.minutes + transitionMinutes) / (transitionMinutes * 2)), smooth((minute - set.minutes + transitionMinutes) / (transitionMinutes * 2)));
  const dawn = Math.max(0, 1 - Math.abs(minute - rise.minutes) / (transitionMinutes * 2));
  const dusk = Math.max(0, 1 - Math.abs(minute - set.minutes) / (transitionMinutes * 2));
  const aboveHorizon = minute >= rise.minutes && minute <= set.minutes;
  const progress = aboveHorizon ? (minute - rise.minutes) / (set.minutes - rise.minutes)
    : (minute < rise.minutes ? minute + 1440 - set.minutes : minute - set.minutes) / (1440 - set.minutes + rise.minutes);
  return {
    phase: dawn > 0 ? 'sunrise' : dusk > 0 ? 'sunset' : aboveHorizon ? 'day' : 'night', night, dawn, dusk,
    position: { x: aboveHorizon ? 8 + 144 * progress : 152 - 144 * progress, y: aboveHorizon ? 24 - 80 * progress * (1 - progress) : 24 + 36 * progress * (1 - progress), aboveHorizon },
  };
}
