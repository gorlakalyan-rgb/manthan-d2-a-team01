import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';

const TZ = 'Asia/Kolkata';
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const longFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, dateStyle: 'full', timeStyle: 'long', hour12: true });

/** Ticks once a second, aligned to the next whole second. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t;
    const tick = () => { setNow(new Date()); t = setTimeout(tick, 1000 - (Date.now() % 1000)); };
    t = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(t);
  }, []);
  return now;
}

/** "Fri, 27 Nov 2026" (en-IN puts a comma before the year; we drop it). */
function dateText(d) {
  const p = Object.fromEntries(dateFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** Splits "05:42:10 pm" into parts so we can style the seconds and AM/PM. */
function parts(d) {
  const p = Object.fromEntries(timeFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { hm: `${p.hour}:${p.minute}`, s: p.second, ap: (p.dayPeriod || '').toUpperCase() };
}

/** Live 12-hour IST clock with date, for the top bar. Not an aria-live region (it would announce every second). */
export default function LiveClock({ compact = false }) {
  const now = useNow();
  const { hm, s, ap } = parts(now);
  return (
    <time className={`live-clock ${compact ? 'compact' : ''}`} dateTime={now.toISOString()} title={`${longFmt.format(now)}`}
      aria-label={`Current time ${hm} ${ap}, ${dateText(now)}, India Standard Time`}>
      <span className="lc-time" aria-hidden="true">
        <span className="lc-hm">{hm}</span><span className="lc-s">:{s}</span><span className="lc-ap">{ap}</span>
      </span>
      {!compact && (
        <span className="lc-date" aria-hidden="true"><CalendarDays size={12} /> {dateText(now)} · IST</span>
      )}
    </time>
  );
}

export { timeFmt as clockTimeFormat, dateFmt as clockDateFormat };
