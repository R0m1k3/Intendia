#!/usr/bin/env bash
# Starts Intendia (repo build) against a real Hermes started by start-hermes.sh, then runs smoke-checks.sh.
# Env: API_KEY, DASH_TOKEN (as given to start-hermes.sh), EXPECT_VERSION (optional, passed on).
set -euo pipefail
: "${API_KEY:?}" "${DASH_TOKEN:?}"
cd "$(dirname "$0")/../.."
D=$(mktemp -d)
INTENDIA_INSTANCES='[{"id":"real","label":"Hermes réel","api":"http://127.0.0.1:8642","apiKey":"'"$API_KEY"'","dashboard":"http://127.0.0.1:9119","dashboardToken":"'"$DASH_TOKEN"'"}]' \
INTENDIA_SECRET=$(openssl rand -hex 32) INTENDIA_DATA_DIR=$D INTENDIA_PORT=3000 INTENDIA_MCP_PORT=3002 \
INTENDIA_WEB_DIR=apps/web/dist nohup node apps/server/dist/index.js > /tmp/intendia.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
U=http://127.0.0.1:3000 INST=real LOGCMD='cat /tmp/intendia.log' \
  WS_CHECK='docker run --rm -v hermes-data:/opt/data busybox test -f /opt/data/workspace/essai/AGENTS.md' \
  .github/scripts/smoke-checks.sh
