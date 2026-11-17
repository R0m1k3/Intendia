#!/usr/bin/env bash
# Follows docs/install.md with the image built by CI (intendia:ci) against fake-hermes on the host:
# uid 10000, data volume, no workspace volume, instance declared in INTENDIA_INSTANCES; then the shared
# smoke-checks.sh (installation code from the logs, password, modules, a workspace written through the fake
# dashboard whose managed files root is $FAKE_FILES_ROOT, reads, one paused cron), and the container healthcheck.
set -euo pipefail
U=http://127.0.0.1:3000
fail() { echo "FAIL: $*"; docker logs intendia 2>&1 | tail -30; exit 1; }

docker volume create intendia-data >/dev/null
: "${FAKE_FILES_ROOT:?FAKE_FILES_ROOT must be the managed files root of the fake Hermes}"

docker run -d --name intendia --network host --user 10000:10000 \
  -v intendia-data:/data \
  -e INTENDIA_SECRET="$(openssl rand -hex 32)" \
  -e INTENDIA_PUBLIC_URL=http://127.0.0.1:3000 \
  -e INTENDIA_INSTANCES='[{"id":"fake","label":"Hermes simulé","api":"http://127.0.0.1:18642","apiKey":"fake-api-key-000000000000","dashboard":"http://127.0.0.1:19119","dashboardToken":"fake-dashboard-token"}]' \
  intendia:ci >/dev/null

U=$U INST=fake LOGCMD='docker logs intendia' WS_CHECK="test -f $FAKE_FILES_ROOT/essai/AGENTS.md" \
  "$(dirname "$0")/smoke-checks.sh"

docker inspect --format '{{.State.Health.Status}}' intendia
for i in $(seq 1 15); do [ "$(docker inspect --format '{{.State.Health.Status}}' intendia)" = healthy ] && break; sleep 3; done
[ "$(docker inspect --format '{{.State.Health.Status}}' intendia)" = healthy ] || fail "healthcheck"
echo "OK   container healthy"
