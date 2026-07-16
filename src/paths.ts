import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function tgClaudeHome(): string {
  return process.env.TG_CLAUDE_HOME ?? join(homedir(), '.tg-claude');
}
export function projectsDir(): string {
  return process.env.PROJECTS_DIR ?? join(homedir(), 'projects');
}
export function stateFile(): string { return join(tgClaudeHome(), 'state.json'); }
export function tasksRoot(): string { return join(tgClaudeHome(), 'tasks'); }
export function taskDir(id: string): string { return join(tasksRoot(), id); }
export function metaFile(id: string): string { return join(taskDir(id), 'meta.json'); }
export function eventsFile(id: string): string { return join(taskDir(id), 'events.jsonl'); }
export function inboxDir(id: string): string { return join(taskDir(id), 'inbox'); }
export function inboxDoneDir(id: string): string { return join(taskDir(id), 'inbox', 'done'); }
export function stopFile(id: string): string { return join(taskDir(id), 'stop'); }
export function reportedFile(id: string): string { return join(taskDir(id), 'reported'); }
export function cursorFile(id: string): string { return join(taskDir(id), 'cursor'); }
export function pidFile(id: string): string { return join(taskDir(id), 'pid'); }
export function runnerLogFile(id: string): string { return join(taskDir(id), 'runner.log'); }
export function ensureDir(p: string): void { mkdirSync(p, { recursive: true }); }
