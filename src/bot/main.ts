import { Bot } from 'grammy';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../events.js';
import { ensureDir, projectsDir, tasksRoot } from '../paths.js';
import { defaultSession, getChat, loadState, readTaskMeta, saveState } from '../state.js';
import type { ChatState, Session, TaskEvent } from '../types.js';
import { composeForward, sessionTag } from './format.js';
import { effortKb, forwardTargetsKb, modeKb, modelKb, MODELS, noCommentKb, projectsKb, sessionsKb } from './keyboards.js';
import { TaskManager } from './tasks.js';
import { escapeHtml } from '../markdown.js';
import type { Effort } from '../types.js';

const EFFORT_SET = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const modelLabel = (id: string | null): string => id ? (MODELS.find((m) => m.id === id)?.label ?? id) : 'по умолчанию';

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowed = Number(process.env.ALLOWED_USER_ID);
if (!token || !allowed) { console.error('TELEGRAM_BOT_TOKEN и ALLOWED_USER_ID обязательны'); process.exit(2); }

ensureDir(tasksRoot());
ensureDir(projectsDir());

const state = loadState();
const bot = new Bot(token);
const tm = new TaskManager(bot.api, state);

const NAME_RE = /^[\p{L}\p{N}_-]{1,16}$/u;

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== allowed) {
    console.log(`ignored user ${ctx.from?.id}`);
    return;
  }
  await next();
});

function cur(chat: ChatState): Session {
  return chat.sessions[chat.current];
}

function listProjects(): string[] {
  try {
    return readdirSync(projectsDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch { return []; }
}

const HELP = [
  'Пиши текст — это задача для Claude в текущей сессии.',
  'Если задача сессии уже работает, текст впрыснется в неё.',
  '',
  '/sessions — сессии (переключение, создание)',
  '/reset — новый диалог Claude в текущей сессии',
  '/projects — проект текущей сессии',
  '/model — модель (Fable/Opus/Sonnet/Haiku)',
  '/effort — глубина рассуждений (low…max)',
  '/mode — 🚀 автономный / 📋 план',
  '/status — все сессии и задачи',
  '/stop — остановить задачу текущей сессии',
].join('\n');

bot.command(['start', 'help'], (ctx) => ctx.reply(HELP));

bot.command('sessions', (ctx) => {
  const chat = getChat(state, ctx.chat.id);
  return ctx.reply('Сессии:', { reply_markup: sessionsKb(chat) });
});

bot.command('reset', (ctx) => {
  const chat = getChat(state, ctx.chat.id);
  cur(chat).claudeSessionId = null;
  saveState(state);
  return ctx.reply(`${sessionTag(chat.current)}: контекст сброшен, следующее сообщение начнёт новый диалог.`, { parse_mode: 'HTML' });
});

bot.command('projects', (ctx) => ctx.reply('Проекты (~/projects):', { reply_markup: projectsKb(listProjects()) }));

bot.command('model', (ctx) => ctx.reply('Модель текущей сессии:', { reply_markup: modelKb() }));

bot.command('effort', (ctx) => ctx.reply('Глубина рассуждений (больше = умнее и дороже):', { reply_markup: effortKb() }));

bot.command('mode', (ctx) => ctx.reply('Режим текущей сессии:', { reply_markup: modeKb() }));

bot.command('status', (ctx) => {
  const chat = getChat(state, ctx.chat.id);
  const lines = Object.values(chat.sessions).map((s) => {
    const mark = s.name === chat.current ? '👉' : '·';
    const run = tm.isRunning(s) ? '🟢 работает' : '⚪ ожидает';
    const brain = `${modelLabel(s.model)} · effort ${s.effort ?? 'дефолт'}`;
    const sid = s.claudeSessionId ? `\n   resume: <code>${s.claudeSessionId}</code>` : '';
    return `${mark} <b>${escapeHtml(s.name)}</b> — ${run}\n   📁 ${escapeHtml(s.cwd)}\n   🧠 ${escapeHtml(brain)} · ${s.mode === 'plan' ? '📋 план' : '🚀 авто'}${sid}`;
  });
  return ctx.reply(lines.join('\n\n'), { parse_mode: 'HTML' });
});

bot.command('stop', (ctx) => {
  const chat = getChat(state, ctx.chat.id);
  const s = cur(chat);
  if (!s.activeTaskId || !tm.isRunning(s)) return ctx.reply('Нет активной задачи в текущей сессии.');
  tm.requestStop(s.activeTaskId);
  return ctx.reply(`${sessionTag(s.name)}: останавливаю…`, { parse_mode: 'HTML' });
});

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const chat = getChat(state, ctx.chat!.id);
  const [kind, ...rest] = data.split(':');
  const arg = rest.join(':');

  if (kind === 'sess') {
    if (arg === 'new') {
      chat.pending = { kind: 'new-session' };
      saveState(state);
      await ctx.reply('Имя новой сессии (до 16 символов, буквы/цифры/-/_):');
    } else if (chat.sessions[arg]) {
      chat.current = arg;
      saveState(state);
      await ctx.reply(`Текущая сессия: ${sessionTag(arg)}`, { parse_mode: 'HTML' });
    }
  } else if (kind === 'proj') {
    if (arg === 'new') {
      chat.pending = { kind: 'new-project' };
      saveState(state);
      await ctx.reply('Имя нового проекта (папки):');
    } else {
      const dir = listProjects()[Number(arg)];
      if (!dir) {
        await ctx.reply('Список проектов изменился — открой /projects заново.');
      } else {
        cur(chat).cwd = join(projectsDir(), dir);
        cur(chat).claudeSessionId = null;
        saveState(state);
        await ctx.reply(`${sessionTag(chat.current)}: проект → <code>${escapeHtml(dir)}</code> (контекст сброшен)`, { parse_mode: 'HTML' });
      }
    }
  } else if (kind === 'model') {
    cur(chat).model = arg === 'default' ? null : arg;
    saveState(state);
    await ctx.reply(`${sessionTag(chat.current)}: модель → ${modelLabel(cur(chat).model)}`, { parse_mode: 'HTML' });
  } else if (kind === 'effort') {
    cur(chat).effort = arg === 'default' || !EFFORT_SET.has(arg) ? null : (arg as Effort);
    saveState(state);
    await ctx.reply(`${sessionTag(chat.current)}: effort → ${cur(chat).effort ?? 'по умолчанию'}`, { parse_mode: 'HTML' });
  } else if (kind === 'mode') {
    cur(chat).mode = arg === 'plan' ? 'plan' : 'auto';
    saveState(state);
    await ctx.reply(`${sessionTag(chat.current)}: режим → ${arg === 'plan' ? '📋 план' : '🚀 автономный'}`, { parse_mode: 'HTML' });
  } else if (kind === 'fwd') {
    await ctx.reply('Куда переслать отчёт?', { reply_markup: forwardTargetsKb(arg, Object.keys(chat.sessions), readTaskMeta(arg).sessionName) });
  } else if (kind === 'fwdto') {
    const [taskId, to] = [rest[0], rest.slice(1).join(':')];
    chat.pending = { kind: 'forward-comment', taskId, from: readTaskMeta(taskId).sessionName, to };
    saveState(state);
    await ctx.reply(`Пересылаю в ${sessionTag(to)}. Добавь комментарий текстом или жми кнопку:`, { parse_mode: 'HTML', reply_markup: noCommentKb(taskId, to) });
  } else if (kind === 'fwdgo') {
    const [taskId, to] = [rest[0], rest.slice(1).join(':')];
    chat.pending = undefined;
    saveState(state);
    await dispatchForward(ctx.chat!.id, chat, taskId, to, null);
    await ctx.reply(`Отправлено в ${sessionTag(to)} ✅`, { parse_mode: 'HTML' });
  } else if (kind === 'cont') {
    const meta = readTaskMeta(arg);
    const s = chat.sessions[meta.sessionName];
    if (!s) { await ctx.reply('Сессия этой задачи уже удалена.'); }
    else if (tm.isRunning(s)) { await ctx.reply(`${sessionTag(s.name)}: задача уже выполняется.`, { parse_mode: 'HTML' }); }
    else {
      const initEv = [...readEvents(arg)].reverse().find((e): e is Extract<TaskEvent, { type: 'init' }> => e.type === 'init');
      s.claudeSessionId = initEv?.sessionId ?? s.claudeSessionId;
      saveState(state);
      await tm.startTask(ctx.chat!.id, s, 'Продолжай выполнение прерванной задачи с того места, где остановился.');
    }
  }
  await ctx.answerCallbackQuery();
});

async function dispatchForward(chatId: number, chat: ChatState, taskId: string, to: string, comment: string | null): Promise<void> {
  const report = tm.lastReport(taskId) ?? '(отчёт не найден)';
  const from = readTaskMeta(taskId).sessionName;
  const text = composeForward(comment, from, report);
  await dispatchToSession(chatId, chat, to, text);
}

async function dispatchToSession(chatId: number, chat: ChatState, sessionName: string, text: string): Promise<void> {
  const s = chat.sessions[sessionName];
  if (!s) return;
  if (s.activeTaskId && tm.isRunning(s)) {
    tm.inject(s.activeTaskId, text);
    await bot.api.sendMessage(chatId, `${sessionTag(sessionName)}: 📨 передал в работающую задачу`, { parse_mode: 'HTML' });
  } else {
    await tm.startTask(chatId, s, text);
  }
}

bot.on('message:text', async (ctx) => {
  const chat = getChat(state, ctx.chat.id);
  const text = ctx.message.text;

  const pending = chat.pending;
  if (pending?.kind === 'new-session') {
    chat.pending = undefined;
    if (!NAME_RE.test(text)) { saveState(state); return void ctx.reply('Некорректное имя. /sessions и попробуй снова.'); }
    if (!chat.sessions[text]) chat.sessions[text] = defaultSession(text);
    chat.current = text;
    saveState(state);
    return void ctx.reply(`Создана и выбрана сессия ${sessionTag(text)}`, { parse_mode: 'HTML' });
  }
  if (pending?.kind === 'new-project') {
    chat.pending = undefined;
    const name = text.trim().replace(/[^\p{L}\p{N}_.-]/gu, '-').slice(0, 40);
    if (!name) { saveState(state); return void ctx.reply('Некорректное имя проекта.'); }
    mkdirSync(join(projectsDir(), name), { recursive: true });
    cur(chat).cwd = join(projectsDir(), name);
    cur(chat).claudeSessionId = null;
    saveState(state);
    return void ctx.reply(`${sessionTag(chat.current)}: проект → <code>${escapeHtml(name)}</code>`, { parse_mode: 'HTML' });
  }
  if (pending?.kind === 'forward-comment') {
    chat.pending = undefined;
    saveState(state);
    await dispatchForward(ctx.chat.id, chat, pending.taskId, pending.to, text);
    return void ctx.reply(`Отправлено в ${sessionTag(pending.to)} ✅`, { parse_mode: 'HTML' });
  }

  await dispatchToSession(ctx.chat.id, chat, chat.current, text);
});

bot.catch((err) => console.error('bot error:', err.error));

await bot.api.setMyCommands([
  { command: 'sessions', description: 'Сессии: переключить/создать' },
  { command: 'status', description: 'Статус всех сессий' },
  { command: 'projects', description: 'Проект текущей сессии' },
  { command: 'model', description: 'Модель (Fable/Opus/Sonnet/Haiku)' },
  { command: 'effort', description: 'Глубина рассуждений (low…max)' },
  { command: 'mode', description: 'Режим: автономный/план' },
  { command: 'reset', description: 'Сбросить контекст сессии' },
  { command: 'stop', description: 'Остановить задачу' },
  { command: 'help', description: 'Справка' },
]);

await tm.reattachAll();
console.log('tg-claude bot started');
await bot.start();
