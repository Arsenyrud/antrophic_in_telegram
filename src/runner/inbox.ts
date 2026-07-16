import { existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, inboxDir, inboxDoneDir, stopFile } from '../paths.js';

export interface TurnState { active: boolean; lastActivity: number }
export interface StreamCtrl { closed: boolean }

export interface SDKUserMsg {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

function userMsg(text: string): SDKUserMsg {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' };
}

export function drainInbox(taskId: string): string[] {
  const dir = inboxDir(taskId);
  if (!existsSync(dir)) return [];
  ensureDir(inboxDoneDir(taskId));
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.txt'))
    .map((d) => d.name)
    .sort();
  const texts: string[] = [];
  for (const f of files) {
    texts.push(readFileSync(join(dir, f), 'utf8'));
    renameSync(join(dir, f), join(inboxDoneDir(taskId), f));
  }
  return texts;
}

export async function* makeInputStream(opts: {
  taskId: string;
  prompt: string;
  turn: TurnState;
  ctrl: StreamCtrl;
  idleMs?: number;
  pollMs?: number;
  onInject?: (text: string) => void;
}): AsyncGenerator<SDKUserMsg> {
  const { taskId, prompt, turn, ctrl } = opts;
  const idleMs = opts.idleMs ?? 120_000;
  const pollMs = opts.pollMs ?? 700;
  turn.active = true;
  turn.lastActivity = Date.now();
  yield userMsg(prompt);
  while (!ctrl.closed) {
    if (existsSync(stopFile(taskId))) return;
    for (const text of drainInbox(taskId)) {
      opts.onInject?.(text);
      turn.active = true;
      turn.lastActivity = Date.now();
      yield userMsg(text);
    }
    if (!turn.active && Date.now() - turn.lastActivity > idleMs) {
      // Последний drain перед закрытием: сообщение, записанное ботом ровно на границе
      // простоя (бот уже подтвердил доставку), не должно потеряться.
      const leftover = drainInbox(taskId);
      if (leftover.length === 0) return;
      for (const text of leftover) {
        opts.onInject?.(text);
        turn.active = true;
        turn.lastActivity = Date.now();
        yield userMsg(text);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
