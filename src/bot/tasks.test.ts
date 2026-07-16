import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent } from '../events.js';
import { writeTaskMeta } from '../state.js';
import { cursorFile } from '../paths.js';
import { TaskManager } from './tasks.js';
import type { State, TaskMeta } from '../types.js';

function fakeApi() {
  const calls: { m: string; text: string }[] = [];
  const api = {
    calls,
    async sendMessage(_c: number, text: string) { calls.push({ m: 'send', text }); return { message_id: calls.length }; },
    async editMessageText(_c: number, _id: number, text: string) { calls.push({ m: 'edit', text }); },
    async answerCallbackQuery() { /* noop */ },
  };
  return api;
}

const meta = (id: string): TaskMeta => ({
  taskId: id, chatId: 1, sessionName: 'main', prompt: 'p', cwd: '/tmp',
  resumeSessionId: null, model: null, mode: 'auto', startedAt: Date.now(),
});

const settle = () => new Promise((r) => setTimeout(r, 300));

beforeEach(() => {
  process.env.TG_CLAUDE_HOME = mkdtempSync(join(tmpdir(), 'tgc-'));
});

test('reattach does NOT re-send an already-delivered report (cursor prevents replay)', async () => {
  const id = 'tCUR';
  writeTaskMeta(meta(id));
  appendEvent(id, { type: 'init', sessionId: 's', ts: 1 });
  appendEvent(id, { type: 'turn_done', text: 'REPORT_ALPHA', costUsd: null, turns: 1, ts: 2 });
  appendEvent(id, { type: 'done', ts: 3 });
  writeFileSync(cursorFile(id), '2'); // init + turn_done уже показаны пользователю до рестарта
  const api = fakeApi();
  const tm = new TaskManager(api as never, { chats: {} } as State);
  await tm.reattachAll();
  await settle();
  expect(api.calls.some((c) => c.text.includes('REPORT_ALPHA'))).toBe(false);
});

test('fresh attach DOES deliver the report (cursor=0 baseline)', async () => {
  const id = 'tFRE';
  writeTaskMeta(meta(id));
  appendEvent(id, { type: 'init', sessionId: 's', ts: 1 });
  appendEvent(id, { type: 'turn_done', text: 'REPORT_BETA', costUsd: null, turns: 1, ts: 2 });
  appendEvent(id, { type: 'done', ts: 3 });
  const api = fakeApi();
  const tm = new TaskManager(api as never, { chats: {} } as State);
  await tm.reattachAll();
  await settle();
  expect(api.calls.some((c) => c.text.includes('REPORT_BETA'))).toBe(true);
});
