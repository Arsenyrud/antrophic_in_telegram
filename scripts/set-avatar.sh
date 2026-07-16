#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../.env"
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
curl -sf "$API/setMyProfilePhoto" \
  -F 'photo={"type":"static","photo":"attach://f"}' \
  -F 'f=@scripts/avatar.png'
echo
# bot id берём из getMe, чтобы не хардкодить
BOT_ID=$(curl -sf "$API/getMe" | sed -E 's/.*"id":([0-9]+).*/\1/')
curl -sf "$API/getUserProfilePhotos" -d "user_id=${BOT_ID}" | head -c 200
echo
