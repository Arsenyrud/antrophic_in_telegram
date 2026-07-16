import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { readEvents, tailEvents } from '../events.js';
import { mdToTelegramChunks } from '../markdown.js';
import { ensureDir, inboxDir, pidFile, reportedFile, stopFile, tasksRoot } from '../paths.js';
import { readTaskMeta, saveState, writeTaskMeta } from '../state.js';
import type { Session, State, TaskEvent, TaskMeta } from '../types.js';
import { fmtDuration, renderFinalHeader, renderStatus, sessionTag } from './format.js';
import { spawnRunner } from './spawn.js';
import { Throttler } from './throttle.js';

function newTaskId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function pidAlive(taskId: string): boolean {
  try {
    const pid = Number(readFileSync(pidFile(taskId), 'utf8').trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class TaskManager {
  constructor(private api: Api, private state: State) {}

  async startTask(chatId: number, session: Session, prompt: string): Promise<string> {
    const taskId = newTaskId();
    const meta: TaskMeta = {
      taskId, chatId, sessionName: session.name, prompt,
      cwd: session.cwd, resumeSessionId: session.claudeSessionId,
      model: session.model, mode: session.mode, startedAt: Date.now(),
    };
    writeTaskMeta(meta);
    spawnRunner(taskId);
    session.activeTaskId = taskId;
    saveState(this.state);
    void this.attach(meta);
    return taskId;
  }

  inject(taskId: string, text: string): void {
    ensureDir(inboxDir(taskId));
    writeFileSync(join(inboxDir(taskId), `${Date.now()}.txt`), text);
  }

  requestStop(taskId: string): void {
    ensureDir(inboxDir(taskId));
    writeFileSync(stopFile(taskId), '');
  }

  isRunning(session: Session): boolean {
    if (!session.activeTaskId) return false;
    const events = readEvents(session.activeTaskId);
    const last = events[events.length - 1];
    if (last && (last.type === 'done' || last.type === 'error')) return false;
    return pidAlive(session.activeTaskId);
  }

  lastReport(taskId: string): string | null {
    const events = readEvents(taskId);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'turn_done' && e.text.trim()) return e.text;
    }
    return null;
  }

  private findSession(meta: TaskMeta): Session | null {
    return this.state.chats[String(meta.chatId)]?.sessions[meta.sessionName] ?? null;
  }

  private async attach(meta: TaskMeta): Promise<void> {
    const { taskId, chatId } = meta;
    let statusId: number | null = null;
    try {
      const m = await this.api.sendMessage(chatId, renderStatus(meta.sessionName, [], Date.now(), meta.startedAt), { parse_mode: 'HTML' });
      statusId = m.message_id;
    } catch { /* статус не критичен */ }

    const recent: TaskEvent[] = [];
    const throttler = new Throttler(3000);
    const updateStatus = () => {
      if (statusId === null) return;
      const id = statusId;
      throttler.schedule(async () => {
        await this.api.editMessageText(chatId, id, renderStatus(meta.sessionName, recent, Date.now(), meta.startedAt), { parse_mode: 'HTML' }).catch(() => {});
      });
    };
    const heartbeat = setInterval(updateStatus, 60_000);

    try {
      for await (const ev of tailEvents(taskId)) {
        recent.push(ev);
        if (recent.length > 20) recent.shift();
        if (ev.type === 'init') {
          const s = this.findSession(meta);
          if (s) { s.claudeSessionId = ev.sessionId; saveState(this.state); }
        } else if (ev.type === 'turn_done') {
          if (ev.text.trim()) await this.sendFinal(chatId, meta.sessionName, taskId, ev.text);
        } else if (ev.type === 'limit_wait') {
          await this.api.sendMessage(chatId, renderStatus(meta.sessionName, [ev], Date.now(), meta.startedAt), { parse_mode: 'HTML' }).catch(() => {});
        } else if (ev.type === 'done' || ev.type === 'error') {
          await this.finalize(meta, statusId, ev);
          return;
        }
        updateStatus();
      }
      // tail закончился без done/error — раннер умер
      await this.finalize(meta, statusId, null);
    } finally {
      clearInterval(heartbeat);
      await throttler.flushNow();
    }
  }

  private async sendFinal(chatId: number, sessionName: string, taskId: string, text: string): Promise<void> {
    const chunks = mdToTelegramChunks(text);
    const kb = new InlineKeyboard().text('↪️ Переслать в…', `fwd:${taskId}`);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const body = i === 0 ? `${renderFinalHeader(sessionName)}\n\n${chunks[i]}` : chunks[i];
      try {
        await this.api.sendMessage(chatId, body, { parse_mode: 'HTML', ...(isLast ? { reply_markup: kb } : {}) });
      } catch {
        await this.api.sendMessage(chatId, body.replace(/<[^>]+>/g, ''), isLast ? { reply_markup: kb } : {}).catch(() => {});
      }
    }
  }

  private async finalize(meta: TaskMeta, statusId: number | null, last: TaskEvent | null): Promise<void> {
    const { chatId, taskId } = meta;
    const dur = fmtDuration(Date.now() - meta.startedAt);
    const s = this.findSession(meta);
    if (s && s.activeTaskId === taskId) { s.activeTaskId = null; saveState(this.state); }
    writeFileSync(reportedFile(taskId), '');
    const tag = sessionTag(meta.sessionName);
    if (last?.type === 'done') {
      if (statusId !== null) await this.api.editMessageText(chatId, statusId, `${tag} · ✅ завершено · ${dur}`, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      const reason = last?.type === 'error' ? `ошибка:\n<pre>${last.message.slice(0, 500)}</pre>` : 'процесс задачи умер (возможно, OOM или ребут)';
      const kb = new InlineKeyboard().text('▶️ Продолжить', `cont:${taskId}`);
      if (statusId !== null) await this.api.editMessageText(chatId, statusId, `${tag} · ❌ прервано · ${dur}`, { parse_mode: 'HTML' }).catch(() => {});
      await this.api.sendMessage(chatId, `${tag} · ${reason}`, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
    }
  }

  async reattachAll(): Promise<void> {
    let dirs: string[] = [];
    try { dirs = readdirSync(tasksRoot()); } catch { return; }
    for (const taskId of dirs) {
      if (existsSync(reportedFile(taskId))) continue;
      let meta: TaskMeta;
      try { meta = readTaskMeta(taskId); } catch { continue; }
      const events = readEvents(taskId);
      const last = events[events.length - 1] ?? null;
      const finished = last && (last.type === 'done' || last.type === 'error');
      if (finished || pidAlive(taskId)) {
        // живая — прицепимся и доиграем события; завершённая — finalize внутри attach отработает мгновенно
        void this.attach(meta);
      } else {
        await this.finalize(meta, null, null);
      }
    }
  }
}
