import assert from 'node:assert/strict';
import { buildWeatherDays, upcomingWeatherDays, weatherHourIndex, weatherLocalTime, weatherMidnightDelay, weatherSolarState, formatWeatherTime } from '../src/weather.ts';

const day = { date: '2026-07-07', sunrise: '2026-07-07T07:30', sunset: '2026-07-07T17:15' };
const solar = time => weatherSolarState(day, new Date(`2026-07-07T${time}:00+10:00`), 'Australia/Melbourne');
assert.equal(solar('04:00').phase, 'night');
assert.equal(solar('04:00').night, 1);
assert.equal(solar('07:30').phase, 'sunrise');
assert.equal(solar('07:30').dawn, 1);
assert.equal(solar('07:30').position.x, 8);
assert.equal(solar('07:30').position.y, 24);
assert.equal(solar('12:00').phase, 'day');
assert.equal(solar('12:00').night, 0);
assert(solar('12:00').position.y < solar('09:00').position.y);
assert(solar('09:00').position.x < solar('12:00').position.x);
assert(solar('15:00').position.x > solar('12:00').position.x);
assert.equal(solar('17:15').phase, 'sunset');
assert.equal(solar('17:15').dusk, 1);
assert.equal(solar('17:15').position.x, 152);
assert.equal(solar('17:15').position.y, 24);
assert.equal(solar('22:00').night, 1);
assert.equal(solar('22:00').position.aboveHorizon, false);
assert(solar('22:00').position.y > 24);
for (let minute = 0; minute < 1440; minute++) {
  const state = solar(`${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`);
  assert(state.night >= 0 && state.night <= 1 && state.dawn >= 0 && state.dusk >= 0);
  assert(state.position.x >= 8 && state.position.x <= 152 && state.position.y >= 4 && state.position.y <= 33);
  if (minute) assert(Math.abs(state.night - solar(`${String(Math.floor((minute-1) / 60)).padStart(2,'0')}:${String((minute-1) % 60).padStart(2,'0')}`).night) < .02);
}
assert.equal(weatherSolarState(day, new Date('2026-07-08T12:00:00+10:00'), 'Australia/Melbourne').position, null, 'stale/future days must not show a current sun');
assert.equal(weatherSolarState({...day,sunset:undefined}, new Date(), 'UTC').phase, 'unknown');
assert.equal(weatherSolarState({...day,sunset:day.sunrise}, new Date('2026-07-07T00:00Z'), 'UTC').position, null);
assert.deepEqual(weatherLocalTime('2026-07-07T07:30','America/New_York'), { date:day.date, minutes:450 }, 'offset-free forecast timestamps must retain their local clock');
assert.deepEqual(weatherLocalTime(new Date('2026-07-06T21:30Z'),'Australia/Melbourne'), { date:day.date, minutes:450 });
assert.deepEqual(weatherLocalTime(new Date('2026-12-31T13:30Z'),'Australia/Melbourne'), { date:'2027-01-01', minutes:30 }, 'summer DST and year rollover');
assert.deepEqual(weatherLocalTime('2026-07-07T07:30:00+10:00','America/New_York'), { date:'2026-07-06', minutes:1050 });
assert.equal(weatherLocalTime('2026-07-07T25:00'), null);
assert.equal(weatherLocalTime('bad'), null);
assert.equal(formatWeatherTime('2026-07-07T07:30','Pacific/Honolulu'), formatWeatherTime('2026-07-07T07:30','Australia/Melbourne'));
assert.equal(weatherHourIndex(150,100,100,24),12);
assert.equal(weatherHourIndex(-100,100,100,24),0);
assert.equal(weatherHourIndex(900,100,100,24),23);
assert.equal(weatherHourIndex(150,100,100,1),0);
assert.equal(weatherHourIndex(150,100,100,0),null);
assert.equal(weatherHourIndex(150,100,0,24),null);
const days = buildWeatherDays({ daily:{time:[day.date]}, hourly:{time:[`${day.date}T09:00`,`${day.date}T10:00`,`${day.date}T11:00`,`${day.date}T12:00`],temperature_2m:[12,14,16,18],precipitation:[1,0,2,0],precipitation_probability:[64,0,null,110]} });
assert.deepEqual(days[0].hourly.map(hour=>hour.precipProbability),[64,0,null,100], 'hourly probability is independent of rainfall amount; null is unavailable');
assert.equal(days[0].hourly[1].temp,14);
for (const [instant, zone, expected] of [
  ['2026-12-31T23:59:59.875+11:00', 'Australia/Melbourne', 125],
  ['2027-01-01T00:00:00+11:00', 'Australia/Melbourne', 24 * 60 * 60_000],
  ['2026-03-08T00:00:00-05:00', 'America/New_York', 23 * 60 * 60_000],
  ['2026-11-01T00:00:00-04:00', 'America/New_York', 25 * 60 * 60_000],
  ['2026-10-04T00:00:00+10:00', 'Australia/Melbourne', 23 * 60 * 60_000],
  ['2026-04-05T00:00:00+11:00', 'Australia/Melbourne', 25 * 60 * 60_000],
  ['2026-07-07T13:59:59Z', 'Australia/Melbourne', 1_000],
]) {
  const now = new Date(instant), delay = weatherMidnightDelay(now, zone);
  assert.equal(delay, expected, `${zone} midnight at ${instant}`);
  assert.equal(weatherLocalTime(new Date(+now + delay - 1), zone).date, weatherLocalTime(now, zone).date);
  assert.notEqual(weatherLocalTime(new Date(+now + delay), zone).date, weatherLocalTime(now, zone).date);
}
assert.equal(weatherMidnightDelay(new Date('invalid'), 'UTC'), 60_000);
assert.equal(weatherMidnightDelay(new Date(), 'invalid/timezone'), 60_000);
const rolloverDays = ['2026-12-31','2027-01-01','2027-01-02'].map(date => ({...days[0],date}));
assert.deepEqual(upcomingWeatherDays(rolloverDays,new Date('2026-12-31T13:00Z'),'Australia/Melbourne').map(day=>day.date),['2027-01-01','2027-01-02']);
assert.deepEqual(upcomingWeatherDays(rolloverDays,new Date('2026-12-31T13:00Z'),'America/Los_Angeles').map(day=>day.date),['2026-12-31','2027-01-01','2027-01-02']);
assert.deepEqual(upcomingWeatherDays(rolloverDays,new Date('2027-01-04T00:00Z'),'Australia/Melbourne'),[],'expired forecasts must not masquerade as today after sleep');
console.log('Weather hourly probability, scaled pointer selection, location time/DST, solar position and continuous dawn/dusk/night transitions passed');
console.log('Weather midnight scheduling, DST, year rollover and expired forecast filtering passed');
