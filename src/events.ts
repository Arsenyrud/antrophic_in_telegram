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
    try { out.push(JSON.parse(line) as TaskEvent); } catch { /* partial line */ }
  }
  return out;
}

export function readEvents(taskId: string): TaskEvent[] {
  const file = eventsFile(taskId);
  if (!existsSync(file)) return [];
  return parseLines(readFileSync(file, 'utf8'));
}

const TERMINAL = new Set(['done', 'error']);

// Tails events.jsonl. Ends on a terminal event; or, when `isAlive` is given, once the runner is
// dead and the file is quiet (one grace poll to avoid racing a final write), or if it never
// started within startupMs. Without `isAlive`, runs until done/error.
export async function* tailEvents(
  taskId: string,
  opts: { pollMs?: number; isAlive?: () => boolean; startupMs?: number } = {},
): AsyncGenerator<TaskEvent> {
  const pollMs = opts.pollMs ?? 500;
  const startupMs = opts.startupMs ?? 30_000;
  const isAlive = opts.isAlive;
  const startedAt = Date.now();
  const file = eventsFile(taskId);
  let offset = 0;
  let carry = '';
  let everAlive = false;
  let deadPolls = 0;
  while (true) {
    let grew = false;
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > offset) {
        grew = true;
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
    if (isAlive) {
      const alive = isAlive();
      if (alive) everAlive = true;
      if (grew) {
        deadPolls = 0;
      } else if (everAlive && !alive) {
        if (++deadPolls >= 2) return; // lived and died, no more writes
      } else if (!everAlive && Date.now() - startedAt > startupMs) {
        return; // never started
      } else {
        deadPolls = 0;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
