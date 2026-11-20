const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const PERIOD_DAYS = 14;
const PERIOD_ANCHOR = Date.UTC(2026, 10, 8);
const PAYDAY_ANCHOR = Date.UTC(2026, 10, 27);
const TIME_ZONE = 'America/Indiana/Indianapolis';
const localDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric'
});
const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, timeZoneName: 'shortOffset'
});
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

// Represent calendar dates at UTC midnight for date arithmetic. Resolve the actual
// Indianapolis offset only when converting a date and clock hour to an instant.
function localDay(instant) {
  const parts = localDayFormat.formatToParts(instant);
  const part = type => Number(parts.find(entry => entry.type === type).value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
}

function localInstant(day, hour) {
  // Sample the offset before the Sunday DST transition for a midnight boundary.
  // Monday 9 a.m. is after the transition, so sample later on Monday.
  const clock = day + hour * 60 * 60 * 1000;
  const sample = day + (hour === 0 ? 5 : 14) * 60 * 60 * 1000;
  const offset = offsetFormat.formatToParts(sample).find(entry => entry.type === 'timeZoneName').value;
  const [, sign, hours, minutes = '0'] = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset);
  const offsetMinutes = (sign === '+' ? 1 : -1) * (Number(hours) * 60 + Number(minutes));
  return clock - offsetMinutes * 60 * 1000;
}

function dateKey(day) {
  return new Date(day).toISOString().slice(0, 10);
}

export function readHolidayDates(value) {
  if (!value?.trim()) return new Set();
  const dates = value.split(',').map(date => date.trim());
  if (dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) || dateKey(Date.parse(date)) !== date)) {
    throw Error('PAYROLL_HOLIDAY_CONFIGURATION_INVALID');
  }
  return new Set(dates);
}

function observedDate(date) {
  const weekday = new Date(date).getUTCDay();
  if (weekday === 6) return date - DAY_MS;
  if (weekday === 0) return date + DAY_MS;
  return date;
}

function nthWeekday(year, month, weekday, occurrence) {
  const first = Date.UTC(year, month, 1);
  const offset = (weekday - new Date(first).getUTCDay() + WEEK_DAYS) % WEEK_DAYS;
  return first + (offset + (occurrence - 1) * WEEK_DAYS) * DAY_MS;
}

function federalHolidays(year) {
  const fixed = [
    Date.UTC(year, 0, 1), // New Year's Day
    Date.UTC(year, 6, 4), // Independence Day
    Date.UTC(year, 10, 11), // Veterans Day
    Date.UTC(year, 11, 25) // Christmas Day
  ];
  if (year >= 2021) fixed.push(Date.UTC(year, 5, 19)); // Juneteenth
  const endOfMay = Date.UTC(year, 4, 31);
  const memorialDay = endOfMay - (new Date(endOfMay).getUTCDay() + 6) % WEEK_DAYS * DAY_MS;
  const holidays = [
    ...fixed.map(observedDate),
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    memorialDay,
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    nthWeekday(year, 10, 4, 4) // Thanksgiving
  ];
  if (year >= 1986) holidays.push(nthWeekday(year, 0, 1, 3)); // Martin Luther King Jr. Day
  return holidays.map(dateKey);
}

export function payPeriodAt(instant, additionalHolidays = new Set()) {
  const index = Math.floor((localDay(instant) - PERIOD_ANCHOR) / (PERIOD_DAYS * DAY_MS));
  const first = PERIOD_ANCHOR + index * PERIOD_DAYS * DAY_MS;
  const end = first + PERIOD_DAYS * DAY_MS;
  const last = end - DAY_MS;
  const scheduled = PAYDAY_ANCHOR + index * PERIOD_DAYS * DAY_MS;
  const year = day => new Date(day).getUTCFullYear();
  const firstYear = year(first);
  // New Year's Day can be observed on December 31 of the preceding year.
  const holidayDates = new Set([...additionalHolidays, ...federalHolidays(firstYear), ...federalHolidays(firstYear + 1)]);
  const payday = holidayDates.has(dateKey(scheduled)) ? scheduled - DAY_MS : scheduled;
  const span = year(first) === year(last) ? shortDate.format(first) : fullDate.format(first);
  return {
    from: new Date(localInstant(first, 0)).toISOString(),
    to: new Date(localInstant(end, 0)).toISOString(),
    label: span + ' – ' + shortDate.format(last) + ', ' + year(last),
    payday: fullDate.format(payday),
    unpaidHolidays: Array.from({ length: PERIOD_DAYS }, (_, day) => dateKey(first + day * DAY_MS))
      .filter(date => holidayDates.has(date))
  };
}

export function workweeksInRange(from, to) {
  const first = localDay(from);
  const daysSinceMonday = (new Date(first).getUTCDay() + 6) % WEEK_DAYS;
  let monday = first - daysSinceMonday * DAY_MS;
  if (localInstant(monday, 9) > from) monday -= WEEK_DAYS * DAY_MS;
  const windows = [];
  for (let start = localInstant(monday, 9); start < to;) {
    monday += WEEK_DAYS * DAY_MS;
    const end = localInstant(monday, 9);
    windows.push({ workweekFrom: start, workweekTo: end, from: Math.max(from, start), to: Math.min(to, end) });
    start = end;
  }
  return windows;
}

export function daysInRange(from,to) {
  const windows=[];
  for(let day=localDay(from),start=localInstant(day,0);start<to;){
    const end=localInstant(day+DAY_MS,0);
    windows.push({date:dateKey(day),from:Math.max(from,start),to:Math.min(to,end)});
    day+=DAY_MS;
    start=end;
  }
  return windows;
}
