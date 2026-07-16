import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, writeFileSync } from 'node:fs';
import { appendEvent } from '../events.js';
import { isUsageLimitError, parseResetTime } from '../limits.js';
import { pidFile, stopFile } from '../paths.js';
import { readTaskMeta } from '../state.js';
import type { TaskEvent } from '../types.js';
import { makeInputStream, type StreamCtrl, type TurnState } from './inbox.js';
import { toolDetail } from './summarize.js';

const taskId = process.argv[2];
if (!taskId) { console.error('usage: runner <taskId>'); process.exit(2); }

const meta = readTaskMeta(taskId);
writeFileSync(pidFile(taskId), String(process.pid));

type EventInput = TaskEvent extends infer E ? (E extends TaskEvent ? Omit<E, 'ts'> : never) : never;
const ev = (e: EventInput) => appendEvent(taskId, { ...e, ts: Date.now() } as TaskEvent);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let resumeId = meta.resumeSessionId;
let latestSessionId = resumeId;
let prompt = meta.prompt;

type Outcome = { kind: 'ok' } | { kind: 'limit'; message: string } | { kind: 'error'; message: string };

async function runOnce(): Promise<Outcome> {
  const turn: TurnState = { active: false, lastActivity: Date.now() };
  const ctrl: StreamCtrl = { closed: false };
  const stream = makeInputStream({
    taskId, prompt, turn, ctrl,
    onInject: (t) => ev({ type: 'inject', text: t.slice(0, 200) }),
  });
  const q = query({
    prompt: stream as AsyncIterable<any>,
    options: {
      cwd: meta.cwd,
      permissionMode: meta.mode === 'plan' ? 'plan' : 'bypassPermissions',
      ...(meta.model ? { model: meta.model } : {}),
      ...(meta.effort ? { effort: meta.effort } : {}),
      ...(resumeId ? { resume: resumeId } : {}),
      settingSources: ['user', 'project'],
    } as any,
  });
  const stopTimer = setInterval(() => {
    if (existsSync(stopFile(taskId))) q.interrupt().catch(() => {});
  }, 1000);
  let failure: string | null = null;
  try {
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        latestSessionId = msg.session_id;
        ev({ type: 'init', sessionId: msg.session_id });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use') ev({ type: 'tool', name: block.name, detail: toolDetail(block.name, block.input) });
          else if (block.type === 'text' && block.text?.trim()) ev({ type: 'text', text: block.text.slice(0, 300) });
        }
        turn.active = true;
        turn.lastActivity = Date.now();
      } else if (msg.type === 'result') {
        turn.active = false;
        turn.lastActivity = Date.now();
        if (msg.subtype === 'success') {
          ev({ type: 'turn_done', text: msg.result ?? '', costUsd: msg.total_cost_usd ?? null, turns: msg.num_turns ?? 0 });
        } else {
          // Достаём максимум текста, чтобы распознать лимит подписки (иначе теряется в subtype).
          const detail = msg.result ?? msg.error ?? msg.message ?? (msg.errors ? JSON.stringify(msg.errors) : '');
          console.error('[runner] non-success result:', JSON.stringify(msg).slice(0, 800));
          failure = detail ? String(detail) : `result:${msg.subtype}`;
        }
      }
      if (existsSync(stopFile(taskId))) { ctrl.closed = true; }
    }
  } catch (e: any) {
    failure = String(e?.message ?? e);
  } finally {
    clearInterval(stopTimer);
    ctrl.closed = true;
  }
  if (!failure) return { kind: 'ok' };
  return isUsageLimitError(failure) ? { kind: 'limit', message: failure } : { kind: 'error', message: failure };
}

try {
  for (;;) {
    const outcome = await runOnce();
    if (outcome.kind === 'ok') break;
    if (outcome.kind === 'limit') {
      const resetAt = parseResetTime(outcome.message) ?? null;
      ev({ type: 'limit_wait', resetAt });
      const waitUntil = Date.now() + Math.min(Math.max((resetAt ?? 0) - Date.now(), 15 * 60_000), 6 * 3600_000);
      // Спим до сброса окна, но реагируем на /stop, а не игнорируем его часами.
      while (Date.now() < waitUntil) {
        if (existsSync(stopFile(taskId))) { ev({ type: 'done' }); process.exit(0); }
        await sleep(Math.min(5000, waitUntil - Date.now()));
      }
      resumeId = latestSessionId;
      prompt = 'Продолжай выполнение прерванной задачи с того места, где остановился.';
      continue;
    }
    ev({ type: 'error', message: outcome.message.slice(0, 1000) });
    process.exit(1);
  }
  ev({ type: 'done' });
  process.exit(0);
} catch (e: any) {
  ev({ type: 'error', message: String(e?.message ?? e).slice(0, 1000) });
  process.exit(1);
}
