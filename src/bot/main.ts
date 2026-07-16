import { Bot, type Context } from 'grammy';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from '../events.js';
import { ensureDir, projectsDir, tasksRoot } from '../paths.js';
import { defaultSession, getChat, loadState, readTaskMeta, saveState } from '../state.js';
import type { ChatState, Session, TaskEvent } from '../types.js';
import { composeForward, sessionTag } from './format.js';
import { BOTTOM, BOTTOM_LABELS, bottomKb, cancelKb, effortKb, EFFORTS, forwardTargetsKb, modeKb, modelKb, MODELS, noCommentKb, projectsKb, sessionsKb } from './keyboards.js';
import { TaskManager } from './tasks.js';
import { escapeHtml } from '../markdown.js';
import type { Effort } from '../types.js';

const EFFORT_SET = new Set(EFFORTS.map((e) => e.id));
const modelLabel = (id: string | null): string => id ? (MODELS.find((m) => m.id === id)?.label ?? id) : 'по умолчанию';
const effortLabel = (id: string | null): string => id ? (EFFORTS.find((e) => e.id === id)?.label ?? id) : 'дефолт';

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowed = Number(process.env.ALLOWED_USER_ID);
if (!token || !allowed) { console.error('TELEGRAM_BOT_TOKEN and ALLOWED_USER_ID are required'); process.exit(2); }

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

// A slash command cancels a pending input (session/project name, forward comment),
// so the next plain message isn't mistakenly consumed as that input.
bot.use(async (ctx, next) => {
  const t = ctx.message?.text;
  if (t && t.startsWith('/') && ctx.chat) {
    const chat = getChat(state, ctx.chat.id);
    if (chat.pending) { chat.pending = undefined; saveState(state); }
  }
  await next();
});

function cur(chat: ChatState): Session {
  return chat.sessions[chat.current];
}

function statusText(chat: ChatState): string {
  return Object.values(chat.sessions).map((s) => {
    const mark = s.name === chat.current ? '👉' : '·';
    const run = tm.isRunning(s) ? '🟢 работает' : '⚪ ожидает';
    const brain = `${modelLabel(s.model)} · effort ${effortLabel(s.effort)}`;
    const sid = s.claudeSessionId ? `\n   resume: <code>${s.claudeSessionId}</code>` : '';
    return `${mark} <b>${escapeHtml(s.name)}</b> — ${run}\n   📁 ${escapeHtml(s.cwd)}\n   🧠 ${escapeHtml(brain)} · ${s.mode === 'plan' ? '📋 план' : '🚀 авто'}${sid}`;
  }).join('\n\n');
}

function listProjects(): string[] {
  try {
    return readdirSync(projectsDir(), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch { return []; }
}

const HELP = [
  'Пиши текст — это задача для Claude в текущей сессии.',
  'Если задача сессии уже работает, текст впрыснется в неё.',
  'Ниже — кнопки меню; всё то же есть и командами:',
  '',
  '/guide — что такое сессии и проекты',
  '/sessions — сессии (переключение, создание)',
  '/reset — новый диалог Claude в текущей сессии',
  '/projects — проект текущей сессии',
  '/model — модель (Fable/Opus/Sonnet/Haiku)',
  '/effort — глубина рассуждений (low…🔥 Ultracode)',
  '/mode — 🚀 автономный / 📋 план',
  '/status — все сессии и задачи',
  '/stop — остановить задачу текущей сессии',
].join('\n');

const GUIDE = [
  '<b>Сессии vs Проекты</b>',
  '',
  '📁 <b>Проект</b> — папка на диске (<code>~/projects/имя</code>), рабочая директория, где Claude пишет код, правит файлы, гоняет тесты. Это <i>где</i> агент работает.',
  '',
  '🗂 <b>Сессия</b> — отдельный «чат» с Claude со своим накопленным контекстом диалога. Это <i>с кем</i> ты сейчас разговариваешь. У каждой сессии своё: история диалога, модель (/model), effort (/effort), режим (/mode) и указатель на проект.',
  '',
  '<b>Связь:</b> сессия содержит проект. Разные сессии могут смотреть в одну папку или в разные.',
  '',
  '<b>Сценарий агент↔валидатор:</b> заводишь 2 сессии («агент» и «валидатор») в одном проекте — они видят одни файлы, но это два независимых диалога. Отчёт агента шлёшь валидатору кнопкой «↪️ Переслать в…», ответ — обратно.',
  '',
  '<b>Переключение:</b>',
  '• сменил проект у сессии → поменялась папка, контекст диалога сбрасывается (новая папка = новый разговор);',
  '• сменил сессию → переключился на другой живой диалог, контекст каждого хранится параллельно.',
  '',
  'Короче: <b>проект</b> — это папка (<code>cd</code>), <b>сессия</b> — это вкладка Claude Code, открытая в этой папке.',
].join('\n');

const showSessions = (ctx: Context, chat: ChatState) =>
  ctx.reply('🗂 <b>Сессии</b> — отдельные диалоги с Claude (свой контекст, модель, effort, режим, проект). Переключение не прерывает работу. Подробнее: /guide', { parse_mode: 'HTML', reply_markup: sessionsKb(chat) });

const showProjects = (ctx: Context) =>
  ctx.reply('📁 <b>Проекты</b> — рабочие папки (<code>~/projects</code>), где Claude выполняет код. Проект привязан к текущей сессии. Подробнее: /guide', { parse_mode: 'HTML', reply_markup: projectsKb(listProjects()) });

bot.command(['start', 'help', 'menu'], (ctx) => ctx.reply(HELP, { reply_markup: bottomKb() }));

bot.command('guide', (ctx) => ctx.reply(GUIDE, { parse_mode: 'HTML' }));

// Handle bottom-keyboard taps (a reply keyboard sends the label text).
async function handleBottom(ctx: Context, chat: ChatState, label: string): Promise<void> {
  switch (label) {
    case BOTTOM.sessions: await showSessions(ctx, chat); break;
    case BOTTOM.projects: await showProjects(ctx); break;
    case BOTTOM.model: await ctx.reply('Модель текущей сессии:', { reply_markup: modelKb() }); break;
    case BOTTOM.effort: await ctx.reply('Глубина рассуждений (больше = умнее и дороже):', { reply_markup: effortKb() }); break;
    case BOTTOM.mode: await ctx.reply('Режим текущей сессии:', { reply_markup: modeKb() }); break;
    case BOTTOM.status: await ctx.reply(statusText(chat), { parse_mode: 'HTML' }); break;
    case BOTTOM.reset:
      cur(chat).claudeSessionId = null;
      saveState(state);
      await ctx.reply(`${sessionTag(chat.current)}: контекст сброшен, следующее сообщение начнёт новый диалог.`, { parse_mode: 'HTML' });
      break;
    case BOTTOM.stop: {
      const s = cur(chat);
      if (s.activeTaskId && tm.isRunning(s)) { tm.requestStop(s.activeTaskId); await ctx.reply(`${sessionTag(s.name)}: останавливаю…`, { parse_mode: 'HTML' }); }
      else await ctx.reply('Нет активной задачи в текущей сессии.');
      break;
    }
  }
}

bot.command('sessions', (ctx) => showSessions(ctx, getChat(state, ctx.chat.id)));

bot.command('reset', (ctx) => {
  const chat = getChat(state, ctx.chat.id);
  cur(chat).claudeSessionId = null;
  saveState(state);
  return ctx.reply(`${sessionTag(chat.current)}: контекст сброшен, следующее сообщение начнёт новый диалог.`, { parse_mode: 'HTML' });
});

bot.command('projects', (ctx) => showProjects(ctx));

bot.command('model', (ctx) => ctx.reply('Модель текущей сессии:', { reply_markup: modelKb() }));

bot.command('effort', (ctx) => ctx.reply('Глубина рассуждений (больше = умнее и дороже):', { reply_markup: effortKb() }));

bot.command('mode', (ctx) => ctx.reply('Режим текущей сессии:', { reply_markup: modeKb() }));

bot.command('status', (ctx) => ctx.reply(statusText(getChat(state, ctx.chat.id)), { parse_mode: 'HTML' }));

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
      await ctx.reply('Имя новой сессии (до 16 символов, буквы/цифры/-/_):', { reply_markup: cancelKb() });
    } else if (chat.sessions[arg]) {
      chat.current = arg;
      saveState(state);
      await ctx.reply(`Текущая сессия: ${sessionTag(arg)}`, { parse_mode: 'HTML' });
    }
  } else if (kind === 'sessdel') {
    if (arg === 'main') await ctx.reply('Сессию main удалить нельзя.');
    else if (!chat.sessions[arg]) await ctx.reply('Такой сессии уже нет.');
    else if (tm.isRunning(chat.sessions[arg])) await ctx.reply(`${sessionTag(arg)}: сначала останови задачу (/stop).`, { parse_mode: 'HTML' });
    else {
      delete chat.sessions[arg];
      if (chat.current === arg) chat.current = 'main';
      saveState(state);
      await ctx.reply(`Сессия «${escapeHtml(arg)}» удалена. Текущая: ${sessionTag(chat.current)}`, { parse_mode: 'HTML' });
    }
  } else if (kind === 'proj') {
    if (arg === 'new') {
      chat.pending = { kind: 'new-project' };
      saveState(state);
      await ctx.reply('Имя нового проекта (папки):', { reply_markup: cancelKb() });
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
    const note = cur(chat).effort === 'ultracode' ? ' — xhigh + мульти-агентная оркестрация 🔥' : '';
    await ctx.reply(`${sessionTag(chat.current)}: effort → ${effortLabel(cur(chat).effort)}${note}`, { parse_mode: 'HTML' });
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
  } else if (kind === 'stop') {
    if (tm.taskRunning(arg)) { tm.requestStop(arg); await ctx.reply('⏹ Останавливаю…'); }
    else await ctx.reply('Эта задача уже не выполняется.');
  } else if (kind === 'cancel') {
    chat.pending = undefined;
    saveState(state);
    await ctx.reply('Отменено.');
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

  // Bottom-button tap — intercept first (and cancel any pending input).
  if (BOTTOM_LABELS.has(text)) {
    if (chat.pending) { chat.pending = undefined; saveState(state); }
    await handleBottom(ctx, chat, text);
    return;
  }

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
  { command: 'menu', description: '📋 Меню с кнопками' },
  { command: 'guide', description: 'Что такое сессии и проекты' },
  { command: 'sessions', description: 'Сессии: переключить/создать' },
  { command: 'status', description: 'Статус всех сессий' },
  { command: 'projects', description: 'Проект текущей сессии' },
  { command: 'model', description: 'Модель (Fable/Opus/Sonnet/Haiku)' },
  { command: 'effort', description: 'Глубина рассуждений (low…Ultracode)' },
  { command: 'mode', description: 'Режим: автономный/план' },
  { command: 'reset', description: 'Сбросить контекст сессии' },
  { command: 'stop', description: 'Остановить задачу' },
  { command: 'help', description: 'Справка' },
]);

await tm.reattachAll();
console.log('tg-claude bot started');
// drop_pending_updates: don't replay the backlog after a restart/deploy (avoids duplicate replies).
await bot.start({ drop_pending_updates: true });
