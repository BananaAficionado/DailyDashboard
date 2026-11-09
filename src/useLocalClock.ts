import { useCallback, useEffect, useRef, useState } from 'react';
import { nextLocalMidnightDelay } from './localTime';

const currentTime = () => new Date();

export function useLocalClock(timeZone?: string, readTime = currentTime) {
  const [now, setNow] = useState(readTime);
  const midnight = useRef<number>();
  const refresh = useCallback((): void => {
    const time = readTime();
    setNow(time);
    window.clearTimeout(midnight.current);
    midnight.current = window.setTimeout(refresh, nextLocalMidnightDelay(time, timeZone));
  }, [timeZone, readTime]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(midnight.current);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  return { now, refresh };
}
