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
export function dueDateStatus(dueDate) {
  if (!dueDate) return 'card-due-none';

  const dueStr = dueDate.slice(0, 10);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const daysUntilDue = Math.round((toUtcMs(dueStr) - toUtcMs(todayStr)) / 86400000);

  // Overdue and "due today" both land here too, since they're <= 2 days
  // (zero or negative) — urgency only gets worse the further past due a
  // card is, so they belong in the same most-urgent bucket as day 1/2.
  if (daysUntilDue <= 2) return 'card-due-red';
  if (daysUntilDue <= 7) return 'card-due-orange';
  return 'card-due-green';
}

// True once the due date's calendar day is strictly before today — same
// string-based day-diff approach as dueDateStatus, so "past due" can never
// disagree with the red/orange/green bucketing above.
export function isPastDue(dueDate) {
  if (!dueDate) return false;

  const dueStr = dueDate.slice(0, 10);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return toUtcMs(dueStr) < toUtcMs(todayStr);
}
