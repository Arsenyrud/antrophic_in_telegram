import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChatState, Session, State, TaskMeta } from './types.js';
import { ensureDir, metaFile, projectsDir, stateFile, taskDir } from './paths.js';

function atomicWrite(path: string, data: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function loadState(): State {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as State;
  } catch {
    return { chats: {} };
  }
}

export function saveState(state: State): void {
  atomicWrite(stateFile(), JSON.stringify(state, null, 2));
}

export function defaultSession(name: string): Session {
  return { name, cwd: projectsDir(), claudeSessionId: null, model: null, mode: 'auto', activeTaskId: null };
}

export function getChat(state: State, chatId: number): ChatState {
  const key = String(chatId);
  if (!state.chats[key]) {
    state.chats[key] = { sessions: { main: defaultSession('main') }, current: 'main' };
  }
  return state.chats[key];
}

export function readTaskMeta(taskId: string): TaskMeta {
  return JSON.parse(readFileSync(metaFile(taskId), 'utf8')) as TaskMeta;
}

export function writeTaskMeta(meta: TaskMeta): void {
  ensureDir(taskDir(meta.taskId));
  atomicWrite(metaFile(meta.taskId), JSON.stringify(meta, null, 2));
}

export function taskExists(taskId: string): boolean {
  return existsSync(metaFile(taskId));
}
