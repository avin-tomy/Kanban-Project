// Parses a plain YYYY-MM-DD string as a UTC-midnight timestamp, purely so
// two such timestamps can be subtracted to get a whole day count. Both sides
// of that subtraction go through this same function, so the arbitrary "UTC"
// choice cancels out — this is just a day-difference calculation, never
// treated as an actual moment in time.
function toUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Comparing as plain YYYY-MM-DD strings (not Date objects) deliberately
// avoids UTC/local timezone conversion: dueDate.slice(0, 10) is exactly the
// calendar date the <input type="date"> stored, and Date object arithmetic
// (new Date(...).setHours(0,0,0,0)) silently shifts that by a day whenever
// the local timezone isn't UTC.
//
// Every other function in this file is defined in terms of this one, so the
// red/orange/green bucketing, the overdue flag, and the "days left" label
// can never disagree with each other about what day it is.
export function daysUntilDue(dueDate) {
  if (!dueDate) return null;

  const dueStr = dueDate.slice(0, 10);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return Math.round((toUtcMs(dueStr) - toUtcMs(todayStr)) / 86400000);
}

export function dueDateStatus(dueDate) {
  const days = daysUntilDue(dueDate);
  if (days === null) return 'card-due-none';

  // Overdue and "due today" both land here too, since they're <= 2 days
  // (zero or negative) — urgency only gets worse the further past due a
  // card is, so they belong in the same most-urgent bucket as day 1/2.
  if (days <= 2) return 'card-due-red';
  if (days <= 7) return 'card-due-orange';
  return 'card-due-green';
}

// True once the due date's calendar day is strictly before today.
export function isPastDue(dueDate) {
  const days = daysUntilDue(dueDate);
  return days !== null && days < 0;
}

// A short label for "how much time is left" next to the due date itself —
// distinct from dueDateStatus's color, which only signals urgency tier.
export function daysLeftLabel(dueDate) {
  const days = daysUntilDue(dueDate);
  if (days === null) return null;
  if (days === 0) return 'Due today';
  const plural = (n) => (n === 1 ? 'day' : 'days');
  if (days > 0) return `${days} ${plural(days)} left`;
  const overdueBy = Math.abs(days);
  return `${overdueBy} ${plural(overdueBy)} overdue`;
}
