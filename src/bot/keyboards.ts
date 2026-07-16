import { InlineKeyboard } from 'grammy';
import type { ChatState } from '../types.js';

export function sessionsKb(chat: ChatState): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const name of Object.keys(chat.sessions)) {
    kb.text(name === chat.current ? `✅ ${name}` : name, `sess:${name}`).row();
  }
  return kb.text('➕ новая сессия', 'sess:new');
}

// callback_data ограничен 64 байтами, а имена папок произвольны (в т.ч. кириллица),
// поэтому в callback кладём индекс, а имя резолвим по свежему списку при клике.
export function projectsKb(dirs: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  dirs.forEach((d, i) => kb.text(d, `proj:${i}`).row());
  return kb.text('➕ создать проект', 'proj:new');
}

// Полные ID моделей — их SDK-опция `model` принимает надёжнее коротких алиасов.
// Актуальный лайнап Claude 5 / 4.x.
export const MODELS: { label: string; id: string }[] = [
  { label: 'Fable 5', id: 'claude-fable-5' },
  { label: 'Opus 4.8', id: 'claude-opus-4-8' },
  { label: 'Opus 4.7', id: 'claude-opus-4-7' },
  { label: 'Sonnet 5', id: 'claude-sonnet-5' },
  { label: 'Sonnet 4.6', id: 'claude-sonnet-4-6' },
  { label: 'Haiku 4.5', id: 'claude-haiku-4-5' },
];

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

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
  EFFORTS.forEach((e) => kb.text(e, `effort:${e}`));
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
  return new InlineKeyboard().text('Отправить без комментария', `fwdgo:${taskId}:${to}`);
}
