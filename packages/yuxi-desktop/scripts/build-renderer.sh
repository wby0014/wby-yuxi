#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_DIST="$ROOT/web/dist"
OUT="$ROOT/packages/yuxi-desktop/renderer"

if [ ! -d "$WEB_DIST" ]; then
  echo "web/dist 不存在，先构建前端：cd $ROOT/web && npm install && npm run build" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$WEB_DIST/." "$OUT/"
echo "已复制 web/dist -> $OUT"
