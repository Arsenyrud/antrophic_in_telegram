import type { TaskEvent } from '../types.js';
import { escapeHtml } from '../markdown.js';

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  return `${Math.floor(m / 60)}ч ${m % 60}м`;
}

export function sessionTag(name: string): string {
  return `⚙️ <b>${escapeHtml(name)}</b>`;
}

const TOOL_EMOJI: Record<string, string> = {
  Bash: '🔧', Edit: '✏️', Write: '✏️', NotebookEdit: '✏️', Read: '📖',
  Glob: '🔍', Grep: '🔍', WebFetch: '🌐', WebSearch: '🌐', Task: '🤖', TodoWrite: '📋',
};

function eventLine(ev: TaskEvent): string | null {
  switch (ev.type) {
    case 'tool': return `${TOOL_EMOJI[ev.name] ?? '⚙️'} ${escapeHtml(ev.detail || ev.name)}`;
    case 'text': return `💬 ${escapeHtml(ev.text.slice(0, 120))}`;
    case 'inject': return `📨 ${escapeHtml(ev.text.slice(0, 120))}`;
    case 'limit_wait': {
      const when = ev.resetAt ? new Date(ev.resetAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'через ~15 мин';
      return `⏸ лимит подписки — продолжу ${ev.resetAt ? 'в ' + when : when}`;
    }
    default: return null;
  }
}

export function renderStatus(sessionName: string, events: TaskEvent[], now: number, startedAt: number): string {
  const lines = events.map(eventLine).filter((l): l is string => l !== null).slice(-3);
  const header = `${sessionTag(sessionName)} · работает · ${fmtDuration(now - startedAt)}`;
  return [header, ...lines].join('\n');
}

export function renderFinalHeader(sessionName: string): string {
  return `${sessionTag(sessionName)} · отчёт`;
}

export function composeForward(comment: string | null, fromSession: string, report: string): string {
  const head = comment ? `${comment}\n\n` : '';
  return `${head}---\nОтчёт сессии «${fromSession}»:\n${report}`;
}
