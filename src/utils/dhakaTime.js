const DHAKA_TZ = 'Asia/Dhaka';

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(value) {
  return String(value).replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)]);
}

export function getDhakaParts(input = new Date()) {
  const date = input && typeof input.toDate === 'function' ? input.toDate() : new Date(input);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short'
  });
  const parts = {};
  for (const p of formatter.formatToParts(date)) {
    parts[p.type] = p.value;
  }
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute: parts.minute,
    second: parts.second,
    weekday: parts.weekday,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    monthStr: `${parts.year}-${parts.month}`,
    time24: `${hour}:${parts.minute}`
  };
}

export function getTodayDhaka() {
  return getDhakaParts(new Date()).dateStr;
}

export function getCurrentMonthDhaka() {
  return getDhakaParts(new Date()).monthStr;
}

export function formatDhakaTime(input) {
  if (!input) return '—';
  const date = typeof input.toDate === 'function' ? input.toDate() : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

export function formatDhakaDateTime(input) {
  if (!input) return '—';
  const date = typeof input.toDate === 'function' ? input.toDate() : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(date);
}

export function formatDisplayDate(yyyyMmDd) {
  if (!yyyyMmDd) return '—';
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA_TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(utc);
}

// Bangladesh government weekly holidays: Friday & Saturday
export function isWeekendDhaka(yyyyMmDd) {
  if (!yyyyMmDd) return false;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
  const day = dt.getUTCDay(); // 5 = Fri, 6 = Sat
  return day === 5 || day === 6;
}

export function getDaysInMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const list = [];
  for (let d = 1; d <= days; d++) {
    const dd = String(d).padStart(2, '0');
    list.push(`${yyyyMm}-${dd}`);
  }
  return list;
}

export function getPastDatesInRange(startDateStr, endDateStr) {
  const result = [];
  let current = startDateStr;
  while (current <= endDateStr) {
    result.push(current);
    const [y, m, d] = current.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    current = next.toISOString().slice(0, 10);
    if (result.length > 62) break;
  }
  return result;
}

export function addDaysDhaka(yyyyMmDd, deltaDays) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function computeInitialStatus(serverDate, officeStartTime = '09:00', graceMinutes = 15) {
  const parts = getDhakaParts(serverDate);
  const [hStr, mStr] = parts.time24.split(':');
  const currentMins = Number(hStr) * 60 + Number(mStr);

  const [startH, startM] = String(officeStartTime || '09:00').split(':').map(Number);
  const limitMins = startH * 60 + startM + Number(graceMinutes || 0);

  return currentMins <= limitMins ? 'সময়মতো' : 'বিলম্বিত';
}

export function isDateOlderThanDays(yyyyMmDd, days = 15) {
  if (!yyyyMmDd) return false;
  const cutoff = addDaysDhaka(getTodayDhaka(), -days);
  return yyyyMmDd <= cutoff;
}
