// Local dates can last 23 or 25 hours across daylight-saving changes.
export function nextLocalMidnightDelay(now: Date, timeZone?: string): number {
  try {
    const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = format.format(now), start = now.getTime();
    let low = start, high = start + 27 * 60 * 60_000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (format.format(new Date(middle)) === today) low = middle;
      else high = middle;
    }
    return high - start;
  } catch { return 60_000; }
}
