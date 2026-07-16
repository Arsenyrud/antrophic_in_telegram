import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState, getChat, readTaskMeta, writeTaskMeta } from './state.js';
import type { TaskMeta } from './types.js';

beforeEach(() => {
  process.env.TG_CLAUDE_HOME = mkdtempSync(join(tmpdir(), 'tgc-'));
  process.env.PROJECTS_DIR = mkdtempSync(join(tmpdir(), 'proj-'));
});

test('loadState returns empty state when file missing', () => {
  expect(loadState()).toEqual({ chats: {} });
});

test('save/load roundtrip', () => {
  const s = loadState();
  getChat(s, 42).current = 'main';
  saveState(s);
  expect(loadState().chats['42'].current).toBe('main');
});

test('getChat creates default main session with projectsDir cwd', () => {
  const s = loadState();
  const chat = getChat(s, 7);
  expect(chat.current).toBe('main');
  expect(chat.sessions['main'].cwd).toBe(process.env.PROJECTS_DIR);
  expect(chat.sessions['main'].mode).toBe('auto');
  expect(chat.sessions['main'].claudeSessionId).toBeNull();
  expect(chat.sessions['main'].model).toBeNull();
  expect(chat.sessions['main'].effort).toBeNull();
});

test('task meta roundtrip', () => {
  const meta: TaskMeta = {
    taskId: 't1', chatId: 42, sessionName: 'main', prompt: 'hi', cwd: '/tmp',
    resumeSessionId: null, model: null, mode: 'auto', startedAt: 123,
  };
  writeTaskMeta(meta);
  expect(readTaskMeta('t1')).toEqual(meta);
});
