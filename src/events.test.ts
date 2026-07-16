import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, readEvents, tailEvents } from './events.js';
import type { TaskEvent } from './types.js';

beforeEach(() => {
  process.env.TG_CLAUDE_HOME = mkdtempSync(join(tmpdir(), 'tgc-'));
});

const ev = (e: Partial<TaskEvent> & { type: TaskEvent['type'] }): TaskEvent =>
  ({ ts: 1, ...e }) as TaskEvent;

test('append + read roundtrip', () => {
  appendEvent('t1', ev({ type: 'init', sessionId: 's-1' } as any));
  appendEvent('t1', ev({ type: 'done' }));
  const events = readEvents('t1');
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ type: 'init', sessionId: 's-1' });
});

test('readEvents on missing file returns []', () => {
  expect(readEvents('nope')).toEqual([]);
});

test('tail yields history then live events and stops on done', async () => {
  appendEvent('t2', ev({ type: 'init', sessionId: 's' } as any));
  const seen: string[] = [];
  const tail = (async () => {
    for await (const e of tailEvents('t2', { pollMs: 20 })) seen.push(e.type);
  })();
  await new Promise((r) => setTimeout(r, 60));
  appendEvent('t2', ev({ type: 'tool', name: 'Bash', detail: 'ls' } as any));
  appendEvent('t2', ev({ type: 'done' }));
  await tail;
  expect(seen).toEqual(['init', 'tool', 'done']);
});
