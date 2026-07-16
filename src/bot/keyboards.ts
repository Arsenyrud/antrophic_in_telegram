import { InlineKeyboard, Keyboard } from 'grammy';
import type { ChatState } from '../types.js';

// Persistent bottom (reply) keyboard labels. A button sends its own text as a message;
// the bot matches these labels and opens the corresponding screen.
export const BOTTOM = {
  sessions: '🗂 Сессии',
  projects: '📁 Проекты',
  model: '🧠 Модель',
  effort: '🎚 Effort',
  mode: '🚀 Режим',
  status: '📊 Статус',
  reset: '🔄 Сброс',
  stop: '⏹ Стоп',
} as const;

export const BOTTOM_LABELS: Set<string> = new Set(Object.values(BOTTOM));

export function bottomKb(): Keyboard {
  return new Keyboard()
    .text(BOTTOM.sessions).text(BOTTOM.projects).row()
    .text(BOTTOM.model).text(BOTTOM.effort).row()
    .text(BOTTOM.mode).text(BOTTOM.status).row()
    .text(BOTTOM.reset).text(BOTTOM.stop)
    .resized()
    .persistent();
}

export function sessionsKb(chat: ChatState): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const name of Object.keys(chat.sessions)) {
    kb.text(name === chat.current ? `✅ ${name}` : name, `sess:${name}`);
    if (name !== 'main') kb.text('🗑', `sessdel:${name}`);
    kb.row();
  }
  return kb.text('➕ новая сессия', 'sess:new');
}

// callback_data is capped at 64 bytes and dir names are arbitrary (incl. Cyrillic),
// so we pass an index and resolve the name from a fresh listing on click.
export function projectsKb(dirs: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  dirs.forEach((d, i) => kb.text(d, `proj:${i}`).row());
  return kb.text('➕ создать проект', 'proj:new');
}

// Full model ids — the SDK `model` option takes them more reliably than short aliases.
export const MODELS: { label: string; id: string }[] = [
  { label: 'Fable 5', id: 'claude-fable-5' },
  { label: 'Opus 4.8', id: 'claude-opus-4-8' },
  { label: 'Opus 4.7', id: 'claude-opus-4-7' },
  { label: 'Sonnet 5', id: 'claude-sonnet-5' },
  { label: 'Sonnet 4.6', id: 'claude-sonnet-4-6' },
  { label: 'Haiku 4.5', id: 'claude-haiku-4-5' },
];

// Effort slider mirroring the Claude Code UI — 6 stops, top = Ultracode.
export const EFFORTS: { label: string; id: string }[] = [
  { label: 'Low', id: 'low' },
  { label: 'Medium', id: 'medium' },
  { label: 'High', id: 'high' },
  { label: 'Extra high', id: 'xhigh' },
  { label: 'Max', id: 'max' },
  { label: '🔥 Ultracode', id: 'ultracode' },
];

export function modelKb(): InlineKeyboard {
  const kb = new InlineKeyboard();
  MODELS.forEach((m, i) => {
    kb.text(m.label, `model:${m.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text('По умолчанию', 'model:default');
}

export function effortKb(): InlineKeyboard {
  const kb = new InlineKeyboard();
  EFFORTS.forEach((e, i) => {
    kb.text(e.label, `effort:${e.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text('По умолчанию', 'effort:default');
}

export function modeKb(): InlineKeyboard {
  return new InlineKeyboard().text('🚀 Автономный', 'mode:auto').text('📋 План', 'mode:plan');
}

export function forwardTargetsKb(taskId: string, sessionNames: string[], from: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const name of sessionNames.filter((n) => n !== from)) kb.text(`→ ${name}`, `fwdto:${taskId}:${name}`).row();
  return kb;
}

export function noCommentKb(taskId: string, to: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Отправить без комментария', `fwdgo:${taskId}:${to}`).row()
    .text('✖️ Отмена', 'cancel');
}

export function cancelKb(): InlineKeyboard {
  return new InlineKeyboard().text('✖️ Отмена', 'cancel');
}

export function stopKb(taskId: string): InlineKeyboard {
  return new InlineKeyboard().text('⏹ Остановить', `stop:${taskId}`);
}
