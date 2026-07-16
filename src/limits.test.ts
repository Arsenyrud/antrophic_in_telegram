import { expect, test } from 'vitest';
import { isUsageLimitError, parseResetTime } from './limits.js';

test('detects usage limit messages', () => {
  expect(isUsageLimitError('Claude AI usage limit reached|1789000000')).toBe(true);
  expect(isUsageLimitError('5-hour limit reached ∙ resets 3am')).toBe(true);
  expect(isUsageLimitError("You've reached your usage limit")).toBe(true);
  expect(isUsageLimitError('ENOENT: no such file')).toBe(false);
  expect(isUsageLimitError('result:error_max_turns')).toBe(false);
});

test('parses epoch after pipe (seconds)', () => {
  expect(parseResetTime('Claude AI usage limit reached|1789000000')).toBe(1789000000000);
});

test('parses epoch after pipe (millis)', () => {
  expect(parseResetTime('limit reached|1789000000000')).toBe(1789000000000);
});

test('parses "resets 3am" as next 3am', () => {
  const now = new Date('2026-07-16T12:00:00');
  const ts = parseResetTime('5-hour limit reached ∙ resets 3am', now)!;
  const d = new Date(ts);
  expect(d.getHours()).toBe(3);
  expect(d.getTime()).toBeGreaterThan(now.getTime());
});

test('parses "resets at 7:30pm" same day', () => {
  const now = new Date('2026-07-16T12:00:00');
  const ts = parseResetTime('limit reached, resets at 7:30pm', now)!;
  const d = new Date(ts);
  expect(d.getHours()).toBe(19);
  expect(d.getMinutes()).toBe(30);
  expect(d.getDate()).toBe(16);
});

test('returns null when nothing parseable', () => {
  expect(parseResetTime("You've reached your usage limit")).toBeNull();
});
