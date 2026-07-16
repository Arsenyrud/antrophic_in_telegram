#!/usr/bin/env bash
set -euo pipefail

echo "== user claude =="
id claude &>/dev/null || useradd -m -s /bin/bash claude
echo 'claude ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/claude
chmod 440 /etc/sudoers.d/claude

echo "== node 22 =="
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== claude cli (для ручной работы и setup-token) =="
npm ls -g @anthropic-ai/claude-code &>/dev/null || npm install -g @anthropic-ai/claude-code

echo "== gh cli =="
if ! command -v gh &>/dev/null; then
  mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" >/etc/apt/sources.list.d/github-cli.list
  apt-get update -qq && apt-get install -y gh
fi

echo "== swap (нужно >= 2.5G суммарно: RAM всего 961M) =="
TOTAL_SWAP_KB=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
if [ "$TOTAL_SWAP_KB" -lt 2500000 ] && [ ! -f /swapfile2 ]; then
  fallocate -l 2G /swapfile2
  chmod 600 /swapfile2
  mkswap /swapfile2
  swapon /swapfile2
  grep -q '/swapfile2' /etc/fstab || echo '/swapfile2 none swap sw 0 0' >>/etc/fstab
fi

echo "== каталоги =="
mkdir -p /opt/tg-claude /etc/tg-claude
mkdir -p /home/claude/projects /home/claude/.tg-claude /home/claude/.claude /home/claude/.ssh
[ -f /home/claude/.ssh/authorized_keys ] || cp /root/.ssh/authorized_keys /home/claude/.ssh/authorized_keys
chmod 700 /home/claude/.ssh && chmod 600 /home/claude/.ssh/authorized_keys

echo "== env-файл =="
if [ ! -f /etc/tg-claude/env ]; then
  cat >/etc/tg-claude/env <<'EOF'
TELEGRAM_BOT_TOKEN=__FILL_ME__
ALLOWED_USER_ID=__FILL_ME__
CLAUDE_CODE_OAUTH_TOKEN=__FILL_ME__
PROJECTS_DIR=/home/claude/projects
TG_CLAUDE_HOME=/home/claude/.tg-claude
HOME=/home/claude
EOF
fi
chown root:claude /etc/tg-claude/env && chmod 640 /etc/tg-claude/env

echo "== systemd =="
cp /opt/tg-claude/deploy/tg-claude-bot.service /etc/systemd/system/tg-claude-bot.service
systemctl daemon-reload
systemctl enable tg-claude-bot

chown -R claude:claude /home/claude /opt/tg-claude
echo "server-setup done"
