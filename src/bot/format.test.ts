import { expect, test } from 'vitest';
import { composeForward, fmtDuration, renderStatus } from './format.js';
import type { TaskEvent } from '../types.js';

test('fmtDuration', () => {
  expect(fmtDuration(45_000)).toBe('45с');
  expect(fmtDuration(12 * 60_000)).toBe('12м');
  expect(fmtDuration(2 * 3600_000 + 13 * 60_000)).toBe('2ч 13м');
});

test('renderStatus shows session, elapsed and last actions', () => {
  const t = 1_000_000;
  const events: TaskEvent[] = [
    { type: 'init', sessionId: 's', ts: t },
    { type: 'tool', name: 'Read', detail: 'src/app.ts', ts: t + 1 },
    { type: 'tool', name: 'Bash', detail: 'npm test', ts: t + 2 },
  ];
  const out = renderStatus('агент', events, t + 60_000, t);
  expect(out).toContain('агент');
  expect(out).toContain('1м');
  expect(out).toContain('npm test');
  expect(out).toContain('src/app.ts');
});

test('renderStatus escapes html in details', () => {
  const events: TaskEvent[] = [{ type: 'tool', name: 'Bash', detail: 'echo "<b>"', ts: 1 }];
  expect(renderStatus('m', events, 2, 1)).toContain('&lt;b&gt;');
});

test('renderStatus shows limit pause', () => {
  const events: TaskEvent[] = [{ type: 'limit_wait', resetAt: null, ts: 1 }];
  expect(renderStatus('m', events, 2, 1)).toContain('лимит');
});

test('composeForward with and without comment', () => {
  const withC = composeForward('проверь пункт 3', 'агент', 'ОТЧЁТ');
  expect(withC).toContain('проверь пункт 3');
  expect(withC).toContain('Отчёт сессии «агент»');
  expect(withC).toContain('ОТЧЁТ');
  const noC = composeForward(null, 'агент', 'ОТЧЁТ');
  expect(noC.startsWith('---')).toBe(true);
});
