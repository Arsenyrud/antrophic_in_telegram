import { appendFileSync, existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import type { TaskEvent } from './types.js';
import { ensureDir, eventsFile, taskDir } from './paths.js';

export function appendEvent(taskId: string, ev: TaskEvent): void {
  ensureDir(taskDir(taskId));
  appendFileSync(eventsFile(taskId), JSON.stringify(ev) + '\n');
}

function parseLines(chunk: string): TaskEvent[] {
  const out: TaskEvent[] = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as TaskEvent); } catch { /* недописанная строка */ }
  }
  return out;
}

export function readEvents(taskId: string): TaskEvent[] {
  const file = eventsFile(taskId);
  if (!existsSync(file)) return [];
  return parseLines(readFileSync(file, 'utf8'));
}

const TERMINAL = new Set(['done', 'error']);

export async function* tailEvents(
  taskId: string,
  opts: { pollMs?: number } = {},
): AsyncGenerator<TaskEvent> {
  const pollMs = opts.pollMs ?? 500;
  const file = eventsFile(taskId);
  let offset = 0;
  let carry = '';
  while (true) {
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > offset) {
        const fd = openSync(file, 'r');
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        closeSync(fd);
        offset = size;
        const text = carry + buf.toString('utf8');
        const lastNl = text.lastIndexOf('\n');
        carry = lastNl === -1 ? text : text.slice(lastNl + 1);
        const complete = lastNl === -1 ? '' : text.slice(0, lastNl + 1);
        for (const ev of parseLines(complete)) {
          yield ev;
          if (TERMINAL.has(ev.type)) return;
        }
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
