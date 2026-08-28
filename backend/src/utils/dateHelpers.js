const DEFAULT_SCHOOL_TIMEZONE = process.env.SCHOOL_TIMEZONE || 'Asia/Ho_Chi_Minh';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WORK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const getZonedParts = (date, timezone = DEFAULT_SCHOOL_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(date));

  return Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
};

const getWorkDate = (date = new Date(), timezone = DEFAULT_SCHOOL_TIMEZONE) => {
  const { year, month, day } = getZonedParts(date, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const isValidWorkDate = (workDate) => {
  if (typeof workDate !== 'string' || !WORK_DATE_PATTERN.test(workDate)) return false;
  const [year, month, day] = workDate.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
};

const isValidTime = (time) => typeof time === 'string' && TIME_PATTERN.test(time);

/**
 * Convert a local school date/time into an absolute instant. The offset is
 * resolved through Intl instead of relying on the server's timezone.
 */
const createDateTime = (workDate, time, timezone = DEFAULT_SCHOOL_TIMEZONE) => {
  if (!isValidWorkDate(workDate) || !isValidTime(time)) {
    return new Date('invalid');
  }

  const [year, month, day] = workDate.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(localAsUtc);

  // Run twice so the computed offset remains correct around DST changes.
  for (let index = 0; index < 2; index += 1) {
    const parts = getZonedParts(instant, timezone);
    const renderedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    instant = new Date(localAsUtc - (renderedAsUtc - instant.getTime()));
  }

  return instant;
};

const startOfWorkDate = (workDate, timezone = DEFAULT_SCHOOL_TIMEZONE) => (
  createDateTime(workDate, '00:00', timezone)
);

const addWorkDays = (workDate, days) => {
  const [year, month, day] = workDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
};

const getWorkDateRange = (workDate, timezone = DEFAULT_SCHOOL_TIMEZONE) => ({
  start: startOfWorkDate(workDate, timezone),
  end: startOfWorkDate(addWorkDays(workDate, 1), timezone)
});

// Kept for legacy callers. New timekeeping code should use work-date helpers.
const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

module.exports = {
  DEFAULT_SCHOOL_TIMEZONE,
  addWorkDays,
  createDateTime,
  getWorkDate,
  getWorkDateRange,
  getZonedParts,
  isValidTime,
  isValidWorkDate,
  startOfDay,
  startOfWorkDate
};
