#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# хост берётся из аргумента, из окружения или из .env (DEPLOY_HOST=root@1.2.3.4)
if [ -f .env ]; then set -a; source .env; set +a; fi
HOST="${1:-${DEPLOY_HOST:-}}"
if [ -z "$HOST" ]; then
  echo "Укажи сервер: bash deploy/deploy.sh root@<ip>  (или DEPLOY_HOST в .env)" >&2
  exit 1
fi

npm run build
npm test

rsync -az --delete --mkpath dist package.json package-lock.json deploy "$HOST":/opt/tg-claude/
ssh "$HOST" 'bash /opt/tg-claude/deploy/server-setup.sh'
ssh "$HOST" 'cd /opt/tg-claude && npm ci --omit=dev && chown -R claude:claude /opt/tg-claude'
ssh "$HOST" 'systemctl restart tg-claude-bot && sleep 2 && systemctl --no-pager status tg-claude-bot | head -15'
echo "deployed"
