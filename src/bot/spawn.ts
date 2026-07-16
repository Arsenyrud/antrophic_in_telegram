import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureDir, runnerLogFile, taskDir } from '../paths.js';

export function runnerEntry(): string {
  return fileURLToPath(new URL('../runner/main.js', import.meta.url));
}

export function spawnRunner(taskId: string): void {
  ensureDir(taskDir(taskId));
  const log = openSync(runnerLogFile(taskId), 'a');
  const child = spawn(process.execPath, [runnerEntry(), taskId], {
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  child.unref();
}
