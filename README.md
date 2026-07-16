# antrophic_in_telegram

Self-hosted Telegram interface to [Claude Code](https://claude.com/claude-code). Send a task in chat — an agent on your VPS writes, runs and tests code, and replies with a report. Tasks run autonomously for hours and survive bot restarts.

## Features

- Full agent: Bash, file edits, git, `gh` — same tools as the Claude Code CLI, running with full autonomy.
- Named parallel sessions (e.g. `agent` + `validator`); switching one doesn't interrupt the others.
- Report forwarding between sessions, with a comment.
- Long tasks (24h+): runners are detached from the bot and outlive restarts and deploys.
- Auto-resume after subscription limits: the task waits for the window to reset and continues.
- Live progress in a single edited message (current file, running command).
- Per-session project (`~/projects/<name>`), model, effort, and mode.
- CLI-compatible sessions: resume from the server with `claude --resume <id>` (id shown in `/status`).

## Requirements

- VPS (Ubuntu 22.04/24.04, 1–2 GB RAM), root SSH.
- Claude Pro/Max subscription (or an Anthropic API key).
- A bot token from [@BotFather](https://t.me/BotFather).
- Your Telegram user ID from [@userinfobot](https://t.me/userinfobot).

## Setup

Node 20+ locally.

```bash
git clone git@github.com:Arsenyrud/antrophic_in_telegram.git
cd antrophic_in_telegram
npm install

cat > .env <<EOF
TELEGRAM_BOT_TOKEN=<from BotFather>
ALLOWED_USER_ID=<your telegram id>
DEPLOY_HOST=root@<server ip>
EOF

bash deploy/deploy.sh
```

`deploy.sh` builds, tests, uploads, creates the `claude` user, installs Node 22 and Claude Code, adds swap, installs the systemd unit, and starts the bot.

Authorize the subscription once:

```bash
ssh root@<ip>
su - claude
claude setup-token          # open the link, paste the code, copy the token
exit
sed -i "s|CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=<token>|" /etc/tg-claude/env
systemctl restart tg-claude-bot
```

Verify:

```bash
cd /opt/tg-claude && sudo -u claude env $(grep -v '^#' /etc/tg-claude/env | xargs) node deploy/smoke.mjs
# → {"subtype":"success",...}
```

### Environment

`/etc/tg-claude/env`:

```
TELEGRAM_BOT_TOKEN=        # from BotFather
ALLOWED_USER_ID=          # only this user may talk to the bot
CLAUDE_CODE_OAUTH_TOKEN=  # from `claude setup-token` — or ANTHROPIC_API_KEY
PROJECTS_DIR=/home/claude/projects
TG_CLAUDE_HOME=/home/claude/.tg-claude
HOME=/home/claude
```

## Usage

Send a task as plain text. A message sent while a task runs is injected into it live.

| Command | Description |
|---|---|
| `/menu` | Buttons for everything below |
| `/guide` | Sessions vs. projects |
| `/sessions` | Switch, create, delete sessions |
| `/projects` | Set the current session's project |
| `/model` | Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5 / default |
| `/effort` | Low … Max, plus Ultracode (xhigh + multi-agent) |
| `/mode` | Autonomous / plan |
| `/reset` | New Claude dialog in the current session |
| `/status` | All sessions: project, model, effort, mode, active tasks |
| `/stop` | Stop the current session's task |

- **Forward to…** under a report sends it to another session (e.g. a validator) with a comment.
- **Continue** appears if a runner dies (OOM/reboot) and resumes from the same point.

## Architecture

```
Telegram ⇄ bot (grammY, systemd) ⇄ task files ⇄ runner × N (detached)
                                                     ⇅
                                    ~/.claude/projects (sessions, shared with CLI)
```

The bot and runners communicate only through files (`events.jsonl`, `inbox/`, `stop`), so tasks don't depend on the bot's lifecycle. A runner wraps the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) in streaming-input mode: user messages are injected into the live session, and subscription limits are waited out automatically.

## Security

- The bot replies only to `ALLOWED_USER_ID`; everyone else is ignored.
- The agent runs with full autonomy (`bypassPermissions`) as the `claude` user with passwordless sudo. Use a dedicated VPS.
- Tokens live in `/etc/tg-claude/env` (`root:claude`, `0640`) and never enter git.

## Development

```bash
npm test        # vitest
npm run build   # tsc → dist/
npm run dev     # run the bot locally (needs .env)
```

## License

MIT
