/**
 * Standard 5-field cron expression parsing and next-match computation for
 * dsh-cron. Dependency-free so tests can import it without the harness.
 *
 * Fields (whitespace-separated):
 *   minute (0-59), hour (0-23), day-of-month (1-31), month (1-12),
 *   day-of-week (0-7, where both 0 and 7 mean Sunday).
 *
 * Per-field syntax: `*`, a single number, `a-b` ranges, `a-b/step` stepped
 * ranges, `a,b,c` lists, a `*` with a `/step` suffix, and month/day names
 * (JAN..DEC, SUN..SAT, case-insensitive).
 *
 * Day matching: when BOTH day-of-month and day-of-week are restricted they
 * match as an OR (Vixie-cron semantics); otherwise the restricted field (or
 * `*`) governs.
 *
 * All matching is against LOCAL time, like ordinary cron.
 * @module dsh-cron/cron
 */

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Maximum lookahead for the next-match scan (~5 years, covers leap-day cron). */
const MAX_SCAN_MS = 5 * 366 * 24 * 60 * 60 * 1000;

/** Parse one cron field into a Set of allowed values, or null when invalid. */
function parseField(text, min, max, names) {
  if (typeof text !== "string" || text.length === 0) return null;
  const values = new Set();
  for (const part of text.split(",")) {
    if (part.length === 0) return null;

    // Optional step suffix.
    let base = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      base = part.slice(0, slash);
      const stepText = part.slice(slash + 1);
      if (!/^\d+$/.test(stepText)) return null;
      step = Number(stepText);
      if (step <= 0) return null;
    }

    let lo;
    let hi;
    if (base === "*") {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(base)) {
      lo = hi = Number(base);
    } else if (/^\d+-\d+$/.test(base)) {
      const [a, b] = base.split("-");
      lo = Number(a);
      hi = Number(b);
      if (lo > hi) return null;
    } else if (names !== undefined && /^[A-Za-z]+$/.test(base)) {
      lo = hi = names[base.toLowerCase()];
      if (lo === undefined) return null;
    } else if (names !== undefined && /^[A-Za-z]+-[A-Za-z]+$/.test(base)) {
      const [a, b] = base.split("-");
      lo = names[a.toLowerCase()];
      hi = names[b.toLowerCase()];
      if (lo === undefined || hi === undefined || lo > hi) return null;
    } else {
      return null;
    }

    if (lo < min || hi > max) return null;
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  if (values.size === 0) return null;
  return values;
}

/**
 * Parse a 5-field cron expression.
 * @param expr - e.g. `0 9 * * 1-5` for weekdays at 09:00. A `*` field with a
 *   `/step` suffix means "every step" (minute `*` + `/30` = every 30 minutes).
 * @returns a parsed cron, or `null` when the expression is invalid.
 */
export function parseCron(expr) {
  if (typeof expr !== "string") return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12, MONTH_NAMES);
  const dow = parseField(parts[4], 0, 7, DOW_NAMES);
  if (minute === null || hour === null || dom === null || month === null || dow === null) {
    return null;
  }

  // Normalize 7 (Sunday) onto 0.
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }

  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domStar: parts[2] === "*",
    dowStar: parts[4] === "*",
    text: parts.join(" "),
  };
}

/** Whether a local date's day satisfies the day-of-month/day-of-week fields. */
function dayMatches(cron, date) {
  const domOk = cron.dom.has(date.getDate());
  const dowOk = cron.dow.has(date.getDay());
  if (cron.domStar && cron.dowStar) return true;
  if (cron.domStar) return dowOk;
  if (cron.dowStar) return domOk;
  return domOk || dowOk;
}

/**
 * Compute the next local wall-clock minute (strictly after `afterMs`) that
 * matches the cron expression.
 * @param cron - a parsed cron from {@link parseCron}.
 * @param afterMs - epoch milliseconds to search after.
 * @returns the matching epoch milliseconds, or `undefined` when no match exists
 *   within the scan window.
 */
export function nextCronTime(cron, afterMs) {
  const date = new Date(afterMs);
  date.setSeconds(0, 0); // truncate to the minute
  date.setTime(date.getTime() + 60_000); // start at the next minute
  const limit = date.getTime() + MAX_SCAN_MS;

  while (date.getTime() <= limit) {
    if (!cron.month.has(date.getMonth() + 1)) {
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      date.setMonth(date.getMonth() + 1);
      continue;
    }
    if (!dayMatches(cron, date)) {
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 1);
      continue;
    }
    if (!cron.hour.has(date.getHours())) {
      date.setMinutes(0, 0, 0);
      date.setHours(date.getHours() + 1);
      continue;
    }
    if (!cron.minute.has(date.getMinutes())) {
      date.setTime(date.getTime() + 60_000);
      continue;
    }
    return date.getTime();
  }
  return undefined;
}
