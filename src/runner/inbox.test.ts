import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drainInbox, makeInputStream, type StreamCtrl, type TurnState } from './inbox.js';
import { inboxDir, stopFile, ensureDir, taskDir } from '../paths.js';

beforeEach(() => {
  process.env.TG_CLAUDE_HOME = mkdtempSync(join(tmpdir(), 'tgc-'));
});

test('drainInbox returns file contents sorted and moves them to done/', () => {
  ensureDir(inboxDir('t'));
  writeFileSync(join(inboxDir('t'), '2.txt'), 'второе');
  writeFileSync(join(inboxDir('t'), '1.txt'), 'первое');
  expect(drainInbox('t')).toEqual(['первое', 'второе']);
  expect(drainInbox('t')).toEqual([]);
});

test('stream yields prompt, then inbox message, then ends on stop file', async () => {
  ensureDir(taskDir('t2'));
  const turn: TurnState = { active: false, lastActivity: Date.now() };
  const ctrl: StreamCtrl = { closed: false };
  const injected: string[] = [];
  const got: string[] = [];
  const it = makeInputStream({ taskId: 't2', prompt: 'старт', turn, ctrl, pollMs: 15, idleMs: 60_000, onInject: (t) => injected.push(t) });
  const consume = (async () => {
    for await (const m of it) got.push(m.message.content as string);
  })();
  await new Promise((r) => setTimeout(r, 40));
  ensureDir(inboxDir('t2'));
  writeFileSync(join(inboxDir('t2'), 'a.txt'), 'доп');
  await new Promise((r) => setTimeout(r, 60));
  writeFileSync(stopFile('t2'), '');
  await consume;
  expect(got).toEqual(['старт', 'доп']);
  expect(injected).toEqual(['доп']);
});

test('stream closes after idle when no turn is active', async () => {
  ensureDir(taskDir('t3'));
  const turn: TurnState = { active: false, lastActivity: Date.now() };
  const ctrl: StreamCtrl = { closed: false };
  const it = makeInputStream({ taskId: 't3', prompt: 'x', turn, ctrl, pollMs: 10, idleMs: 50 });
  const got: string[] = [];
  const started = Date.now();
  for await (const m of it) { got.push(m.message.content as string); turn.active = false; turn.lastActivity = Date.now(); }
  expect(got).toEqual(['x']);
  expect(Date.now() - started).toBeLessThan(2000);
});

test('a message written exactly at the idle boundary is not lost (final drain)', async () => {
  ensureDir(taskDir('t6'));
  const turn: TurnState = { active: false, lastActivity: Date.now() };
  const ctrl: StreamCtrl = { closed: false };
  const it = makeInputStream({ taskId: 't6', prompt: 'x', turn, ctrl, pollMs: 15, idleMs: 40 });
  const got: string[] = [];
  let dropped = false;
  for await (const m of it) {
    got.push(m.message.content as string);
    turn.active = false;
    turn.lastActivity = Date.now();
    // после получения prompt имитируем «бот записал inbox ровно на границе простоя»
    if (!dropped) {
      dropped = true;
      turn.lastActivity = Date.now() - 10_000; // форсируем условие простоя на следующей итерации
      ensureDir(inboxDir('t6'));
      writeFileSync(join(inboxDir('t6'), '9.txt'), 'на-границе');
    }
  }
  expect(got).toEqual(['x', 'на-границе']); // финальный drain подхватил сообщение, а не потерял
});
