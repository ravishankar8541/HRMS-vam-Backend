const TIME_ZONE = 'Asia/Kolkata';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

// Server may run in UTC; payroll months must follow Indian calendar dates.
const today = (now = new Date()) => {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day) };
};

module.exports = { TIME_ZONE, today };
