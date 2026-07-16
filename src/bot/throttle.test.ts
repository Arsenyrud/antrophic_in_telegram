import { expect, test, vi } from 'vitest';
import { Throttler } from './throttle.js';

test('coalesces rapid calls, runs latest, respects min interval', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const th = new Throttler(3000);
  th.schedule(async () => { calls.push('a'); });
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual(['a']); // первый — сразу
  th.schedule(async () => { calls.push('b'); });
  th.schedule(async () => { calls.push('c'); });
  await vi.advanceTimersByTimeAsync(2999);
  expect(calls).toEqual(['a']);
  await vi.advanceTimersByTimeAsync(10);
  expect(calls).toEqual(['a', 'c']); // b перезаписан c
  vi.useRealTimers();
});
