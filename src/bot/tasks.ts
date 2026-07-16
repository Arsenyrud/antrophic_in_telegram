import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { readEvents, tailEvents } from '../events.js';
import { escapeHtml, mdToTelegramChunks } from '../markdown.js';
import { cursorFile, ensureDir, inboxDir, pidFile, reportedFile, stopFile, tasksRoot } from '../paths.js';
import { readTaskMeta, saveState, writeTaskMeta } from '../state.js';
import type { Session, State, TaskEvent, TaskMeta } from '../types.js';
import { fmtDuration, renderFinalHeader, renderStatus, sessionTag } from './format.js';
import { stopKb } from './keyboards.js';
import { spawnRunner } from './spawn.js';
import { Throttler } from './throttle.js';

const EMPTY_KB = { inline_keyboard: [] as never[] };

function newTaskId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

let injectSeq = 0;

function readCursor(taskId: string): number {
  try { return Number(readFileSync(cursorFile(taskId), 'utf8').trim()) || 0; } catch { return 0; }
}
function writeCursor(taskId: string, n: number): void {
  try { writeFileSync(cursorFile(taskId), String(n)); } catch { /* не критично */ }
}

export function pidAlive(taskId: string): boolean {
  let pid: number;
  try { pid = Number(readFileSync(pidFile(taskId), 'utf8').trim()); } catch { return false; }
  if (!pid) return false;
  // На Linux сверяем cmdline: после ребута PID мог переиспользоваться чужим процессом.
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(taskId);
  } catch {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }
}

export class TaskManager {
  constructor(private api: Api, private state: State) {}

  async startTask(chatId: number, session: Session, prompt: string): Promise<string> {
    const taskId = newTaskId();
    const meta: TaskMeta = {
      taskId, chatId, sessionName: session.name, prompt,
      cwd: session.cwd, resumeSessionId: session.claudeSessionId,
      model: session.model, effort: session.effort ?? null, mode: session.mode, startedAt: Date.now(),
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
    // Date.now()+счётчик, чтобы два впрыска в одну миллисекунду не перезатёрли друг друга;
    // порядок сохраняется (drainInbox сортирует лексикографически, seq дополнен нулями).
    const name = `${Date.now()}-${String(injectSeq++).padStart(6, '0')}.txt`;
    writeFileSync(join(inboxDir(taskId), name), text);
  }

  requestStop(taskId: string): void {
    ensureDir(inboxDir(taskId));
    writeFileSync(stopFile(taskId), '');
  }

  isRunning(session: Session): boolean {
    return session.activeTaskId ? this.taskRunning(session.activeTaskId) : false;
  }

  taskRunning(taskId: string): boolean {
    const events = readEvents(taskId);
    const last = events[events.length - 1];
    if (last && (last.type === 'done' || last.type === 'error')) return false;
    return pidAlive(taskId);
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
      const m = await this.api.sendMessage(chatId, renderStatus(meta.sessionName, [], Date.now(), meta.startedAt), { parse_mode: 'HTML', reply_markup: stopKb(taskId) });
      statusId = m.message_id;
    } catch { /* статус не критичен */ }

    const recent: TaskEvent[] = [];
    const throttler = new Throttler(3000);
    const updateStatus = () => {
      if (statusId === null) return;
      const id = statusId;
      throttler.schedule(async () => {
        await this.api.editMessageText(chatId, id, renderStatus(meta.sessionName, recent, Date.now(), meta.startedAt), { parse_mode: 'HTML', reply_markup: stopKb(taskId) }).catch(() => {});
      });
    };
    const heartbeat = setInterval(updateStatus, 60_000);

    // Курсор доставки: сколько событий уже обработано (доставлено пользователю).
    // При рестарте бота reattach не переотправляет ранее показанные отчёты.
    let processed = readCursor(taskId);
    let idx = 0;

    try {
      for await (const ev of tailEvents(taskId, { isAlive: () => pidAlive(taskId) })) {
        idx++;
        const isHistory = idx <= processed;
        recent.push(ev);
        if (recent.length > 20) recent.shift();
        if (ev.type === 'init') {
          const s = this.findSession(meta);
          if (s) { s.claudeSessionId = ev.sessionId; saveState(this.state); }
        }
        if (ev.type === 'done' || ev.type === 'error') {
          writeCursor(taskId, idx);
          await this.finalize(meta, statusId, ev);
          return;
        }
        if (!isHistory) {
          if (ev.type === 'turn_done') {
            if (ev.text.trim()) await this.sendFinal(chatId, meta.sessionName, taskId, ev.text);
          } else if (ev.type === 'limit_wait') {
            await this.api.sendMessage(chatId, renderStatus(meta.sessionName, [ev], Date.now(), meta.startedAt), { parse_mode: 'HTML' }).catch(() => {});
          }
          updateStatus();
        }
        writeCursor(taskId, idx);
      }
      // tail завершился без терминального события — раннер умер (OOM/ребут)
      await this.finalize(meta, statusId, null);
    } finally {
      clearInterval(heartbeat);
      throttler.cancel(); // не перезатирать финальный статус отложенным рендером «работает»
    }
  }

  private async sendFinal(chatId: number, sessionName: string, taskId: string, text: string): Promise<void> {
    const header = renderFinalHeader(sessionName);
    // Резервируем место под заголовок ДО нарезки, чтобы первый кусок + заголовок не превысил 4096.
    const chunks = mdToTelegramChunks(text, Math.max(512, 4096 - header.length - 2));
    const kb = new InlineKeyboard().text('↪️ Переслать в…', `fwd:${taskId}`);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const body = i === 0 ? `${header}\n\n${chunks[i]}` : chunks[i];
      try {
        await this.api.sendMessage(chatId, body, { parse_mode: 'HTML', ...(isLast ? { reply_markup: kb } : {}) });
      } catch {
        const plain = body.replace(/<[^>]+>/g, '').slice(0, 4096);
        await this.api.sendMessage(chatId, plain, isLast ? { reply_markup: kb } : {}).catch(() => {});
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
      if (statusId !== null) await this.api.editMessageText(chatId, statusId, `${tag} · ✅ завершено · ${dur}`, { parse_mode: 'HTML', reply_markup: EMPTY_KB }).catch(() => {});
    } else {
      const reason = last?.type === 'error' ? `ошибка:\n<pre>${escapeHtml(last.message.slice(0, 500))}</pre>` : 'процесс задачи умер (возможно, OOM или ребут)';
      const kb = new InlineKeyboard().text('▶️ Продолжить', `cont:${taskId}`);
      if (statusId !== null) await this.api.editMessageText(chatId, statusId, `${tag} · ❌ прервано · ${dur}`, { parse_mode: 'HTML', reply_markup: EMPTY_KB }).catch(() => {});
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
