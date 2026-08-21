import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCronTime, parseCron } from "../lib/cron.js";

test("parseCron: valid expressions", () => {
  assert.ok(parseCron("* * * * *"));
  assert.ok(parseCron("*/30 * * * *"));
  assert.ok(parseCron("0 9 * * 1-5"));
  assert.ok(parseCron("0 0 1 1 *"));
  assert.ok(parseCron("0,15,30,45 * * * *"));
  assert.ok(parseCron("0 9 * JAN MON"));
  assert.ok(parseCron("30 14 * * MON-FRI"));
  assert.ok(parseCron("0 0 1-15/2 * *"));
});

test("parseCron: invalid expressions", () => {
  assert.equal(parseCron("61 * * * *"), null); // minute 61
  assert.equal(parseCron("* 24 * * *"), null); // hour 24
  assert.equal(parseCron("* * 32 * *"), null); // dom 32
  assert.equal(parseCron("* * * 13 *"), null); // month 13
  assert.equal(parseCron("* * * * 8"), null); // dow 8
  assert.equal(parseCron("* * * *"), null); // 4 fields
  assert.equal(parseCron(""), null);
  assert.equal(parseCron(null), null);
  assert.equal(parseCron("*/x * * * *"), null); // bad step
  assert.equal(parseCron("5-1 * * * *"), null); // reversed range
  assert.equal(parseCron("1.5 * * * *"), null); // non-integer
  assert.equal(parseCron("* * * FOO *"), null); // bad month name
});

test("parseCron: dow 7 normalizes to 0 (Sunday)", () => {
  const cron = parseCron("0 0 * * 7");
  assert.ok(cron.dow.has(0));
  assert.ok(!cron.dow.has(7));
});

test("nextCronTime: */30 steps to the next half hour", () => {
  const cron = parseCron("*/30 * * * *");
  const after = new Date(2026, 0, 1, 12, 0, 0); // Thu 2026-01-01 12:00 local
  const next = new Date(nextCronTime(cron, after.getTime()));
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 0);
  assert.equal(next.getDate(), 1);
  assert.equal(next.getHours(), 12);
  assert.equal(next.getMinutes(), 30); // strictly after 12:00
  assert.equal(next.getSeconds(), 0);
});

test("nextCronTime: daily at 09:00", () => {
  const cron = parseCron("0 9 * * *");
  const after = new Date(2026, 0, 1, 12, 0, 0);
  const next = new Date(nextCronTime(cron, after.getTime()));
  assert.equal(next.getDate(), 2);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
});

test("nextCronTime: weekdays at 14:30", () => {
  const cron = parseCron("30 14 * * MON-FRI");
  // Thu 2026-01-01 14:00 -> same day 14:30
  let next = new Date(nextCronTime(cron, new Date(2026, 0, 1, 14, 0, 0).getTime()));
  assert.equal(next.getDate(), 1);
  assert.equal(next.getHours(), 14);
  assert.equal(next.getMinutes(), 30);
  // Thu 2026-01-01 15:00 -> Fri 2026-01-02 14:30
  next = new Date(nextCronTime(cron, new Date(2026, 0, 1, 15, 0, 0).getTime()));
  assert.equal(next.getDate(), 2);
  assert.equal(next.getHours(), 14);
  // Fri 2026-01-02 15:00 -> Mon 2026-01-05 14:30
  next = new Date(nextCronTime(cron, new Date(2026, 0, 2, 15, 0, 0).getTime()));
  assert.equal(next.getDate(), 5);
  assert.equal(next.getHours(), 14);
});

test("nextCronTime: day-of-month OR day-of-week", () => {
  const cron = parseCron("0 0 13 * FRI");
  // Tue 2026-01-13 01:00 (13th) -> next Fri 2026-01-16 00:00
  const next = new Date(nextCronTime(cron, new Date(2026, 0, 13, 1, 0, 0).getTime()));
  assert.equal(next.getDate(), 16);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
});

test("nextCronTime: monthly on the 1st at 00:00", () => {
  const cron = parseCron("0 0 1 * *");
  const after = new Date(2026, 0, 15, 0, 0, 0);
  const next = new Date(nextCronTime(cron, after.getTime()));
  assert.equal(next.getMonth(), 1); // Feb
  assert.equal(next.getDate(), 1);
  assert.equal(next.getHours(), 0);
});

test("nextCronTime: impossible date returns undefined", () => {
  const cron = parseCron("0 0 31 2 *"); // Feb 31
  assert.equal(nextCronTime(cron, Date.now()), undefined);
});
