import { InlineKeyboard } from 'grammy';
import type { ChatState } from '../types.js';

export function sessionsKb(chat: ChatState): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const name of Object.keys(chat.sessions)) {
    kb.text(name === chat.current ? `✅ ${name}` : name, `sess:${name}`).row();
  }
  return kb.text('➕ новая сессия', 'sess:new');
}

export function projectsKb(dirs: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const d of dirs) kb.text(d, `proj:${d}`).row();
  return kb.text('➕ создать проект', 'proj:new');
}

export function modelKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Opus', 'model:opus').text('Sonnet', 'model:sonnet').row()
    .text('Haiku', 'model:haiku').text('По умолчанию', 'model:default');
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
