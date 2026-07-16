#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../.env"
curl -sf "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyProfilePhoto" \
  -F 'photo={"type":"static","photo":"attach://f"}' \
  -F 'f=@scripts/avatar.png'
echo
curl -sf "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUserProfilePhotos" \
  -d user_id=BOT_ID | head -c 300
