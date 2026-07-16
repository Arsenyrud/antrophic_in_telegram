# antrophic_in_telegram

**Claude Code у тебя в Telegram.** Бот-интерфейс к [Claude Code](https://claude.com/claude-code), живущему на твоём VPS: пишешь задачу в чат — агент на сервере пишет код, запускает, компилирует, тестирует и возвращается с отчётом. Задачи могут работать часами автономно и переживают рестарты.

> **EN (TL;DR):** Self-hosted Telegram interface to Claude Code. Long-running autonomous coding tasks on your own VPS, multiple named parallel sessions (e.g. *agent* + *validator*), report forwarding between sessions, per-session model/mode, live progress in chat. Setup instructions below are in Russian — the commands speak for themselves.

## Возможности

- 🤖 **Полноценный агент** — Bash, правка файлов, git, gh, всё как в Claude Code CLI (режим полной автономии)
- 🔀 **Параллельные именованные сессии** — например «агент» и «валидатор»; переключение не прерывает их работу
- ↪️ **Пересылка отчётов между сессиями** с комментарием (сценарий агент → валидатор → агент)
- ⏱ **Задачи до 24 часов**: раннеры живут отдельно от бота, переживают его рестарты и деплой
- ⏸ **Автопродолжение после лимитов подписки** — задача сама ждёт сброса окна и продолжает
- 📊 **Живой прогресс** в одном обновляемом сообщении: какой файл правится, какая команда бежит
- 🗂 **Проекты**: у каждой сессии своя папка в `~/projects`, выбор/создание кнопками
- 🧠 **Модель и режим на сессию**: Opus/Sonnet/Haiku, автономный/план
- 💻 **Совместимость с CLI**: сессии бота можно продолжить с сервера — `claude --resume <id>` (id показывает `/status`), в т.ч. из VS Code по Remote-SSH

## Что понадобится

1. **VPS** с Ubuntu 22.04/24.04 (хватит 1–2 GB RAM; swap добавится автоматически) и SSH-доступом под root
2. **Подписка Claude Pro/Max** (или API-ключ Anthropic)
3. **Телеграм-бот**: создай у [@BotFather](https://t.me/BotFather) командой `/newbot`, сохрани токен
4. **Свой Telegram user ID**: напиши [@userinfobot](https://t.me/userinfobot) — ответит числом

## Установка

Локально (нужен Node 20+):

```bash
git clone git@github.com:Arsenyrud/antrophic_in_telegram.git
cd antrophic_in_telegram
npm install

cat > .env <<EOF
TELEGRAM_BOT_TOKEN=<токен от BotFather>
ALLOWED_USER_ID=<твой telegram id>
DEPLOY_HOST=root@<ip твоего сервера>
EOF

bash deploy/deploy.sh
```

`deploy.sh` сам: соберёт проект, прогонит тесты, зальёт на сервер, создаст пользователя `claude`, поставит Node 22 и Claude Code, добавит swap, установит systemd-юнит и запустит бота.

### Авторизация подписки Claude (один раз)

```bash
ssh root@<ip> 
su - claude
claude setup-token   # открой ссылку в браузере, вставь код, скопируй выданный токен
exit
sed -i "s|CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=<токен>|" /etc/tg-claude/env
systemctl restart tg-claude-bot
```

Проверка, что агент авторизован:

```bash
cd /opt/tg-claude && sudo -u claude env $(grep -v '^#' /etc/tg-claude/env | xargs) node deploy/smoke.mjs
# → {"subtype":"success",...}
```

### Токены в env

`/etc/tg-claude/env` на сервере:

```
TELEGRAM_BOT_TOKEN=...      # от BotFather
ALLOWED_USER_ID=...         # только этот пользователь может писать боту
CLAUDE_CODE_OAUTH_TOKEN=... # от claude setup-token (подписка) — или ANTHROPIC_API_KEY
PROJECTS_DIR=/home/claude/projects
TG_CLAUDE_HOME=/home/claude/.tg-claude
HOME=/home/claude
```

## Использование

Просто пиши боту задачу текстом. Команды:

| Команда | Что делает |
|---|---|
| `/sessions` | Сессии: переключить, создать новую |
| `/status` | Все сессии: проект, модель, режим, активные задачи |
| `/projects` | Выбрать/создать проект для текущей сессии |
| `/model` | Opus / Sonnet / Haiku / по умолчанию |
| `/mode` | 🚀 автономный / 📋 план (только планирует, ничего не меняет) |
| `/reset` | Начать новый диалог Claude в текущей сессии |
| `/stop` | Остановить задачу текущей сессии |

Приёмы:

- **Сообщение во время работающей задачи** впрыскивается в неё на лету — можно направлять агента, не прерывая.
- **«↪️ Переслать в…»** под отчётом — отправить отчёт другой сессии (например, валидатору) с комментарием.
- **Кнопка «▶️ Продолжить»** появляется, если раннер умер (OOM/ребут) — задача продолжится с того же места.

## Архитектура

```
Telegram ⇄ [bot: grammY, systemd] ⇄ файлы задач ⇄ [runner × N, detached]
                                                        ⇅
                                       ~/.claude/projects (сессии, общие с CLI)
```

Бот и раннеры общаются только через файлы (`events.jsonl`, `inbox/`, `stop`), поэтому задачи не зависят от жизни бота. Раннер — обёртка над [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) со streaming input: сообщения пользователя впрыскиваются в живую сессию, лимиты подписки пережидаются автоматически.

Подробности: [спека](docs/superpowers/specs/2026-07-16-tg-claude-design.md) и [план реализации](docs/superpowers/plans/2026-07-16-tg-claude.md).

## Безопасность

- Бот отвечает **только** пользователю из `ALLOWED_USER_ID`, остальных молча игнорирует.
- Агент работает с полной автономией (`bypassPermissions`) от пользователя `claude` с NOPASSWD sudo — заводи под это **отдельный** VPS и держи там только то, что не жалко доверить агенту.
- Токены живут в `/etc/tg-claude/env` (root:claude, 0640) и не попадают в git.

## Разработка

```bash
npm test        # vitest
npm run build   # tsc → dist/
npm run dev     # локальный запуск бота (нужен .env)
```

## Лицензия

MIT
