#!/usr/bin/env bash
# Follows docs/install.md with the image built by CI (intendia:ci) against fake-hermes on the host:
# uid 10000, data volume, workspace volume owned by 10000, instance declared in INTENDIA_INSTANCES,
# installation code from the logs, password, module check, a workspace written on the volume.
set -euo pipefail
U=http://127.0.0.1:3000
J=$(mktemp)
fail() { echo "FAIL: $*"; docker logs intendia 2>&1 | tail -30; exit 1; }

docker volume create intendia-data >/dev/null
docker volume create workspace >/dev/null
# the Hermes workspace volume belongs to uid 10000 (official image)
docker run --rm -v workspace:/w busybox chown 10000:10000 /w

docker run -d --name intendia --network host --user 10000:10000 \
  -v intendia-data:/data -v workspace:/workspace \
  -e INTENDIA_SECRET="$(openssl rand -hex 32)" \
  -e INTENDIA_PUBLIC_URL=http://127.0.0.1:3000 \
  -e INTENDIA_INSTANCES='[{"id":"fake","label":"Hermes simulé","api":"http://127.0.0.1:18642","apiKey":"fake-api-key-000000000000","dashboard":"http://127.0.0.1:19119","dashboardToken":"fake-dashboard-token","mount":"/workspace"}]' \
  intendia:ci >/dev/null

for i in $(seq 1 30); do curl -sf $U/x/health >/dev/null && break; sleep 2; done
curl -sf $U/x/health | grep -q '"ok":true' || fail "health"
echo "OK   health: $(curl -s $U/x/health)"

code=$(docker logs intendia 2>&1 | sed -n 's/.*Installation code: \([^ ]*\).*/\1/p' | head -1)
[ -n "$code" ] || fail "no installation code in the logs"
echo "OK   installation code in the logs"

curl -sf -c "$J" -H 'x-intendia: 1' -H 'content-type: application/json' \
  -d "{\"code\":\"$code\",\"password\":\"mot-de-passe-de-test-ci\"}" $U/x/setup/password >/dev/null || fail "password"
echo "OK   password chosen"

X() { curl -sf -b "$J" -H 'x-intendia: 1' -H 'content-type: application/json' "$@"; }
for i in $(seq 1 20); do X $U/x/compat | grep -q '"modules"' && break; sleep 1; done
X $U/x/compat | node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf8")).reports[0];
  const bad = r.modules.filter((m) => m.state === "unavailable").map((m) => m.id);
  console.log("OK   modules: " + r.modules.map((m) => m.id + "=" + m.state).join(" "));
  if (bad.length) { console.log("FAIL unavailable: " + bad.join(", ")); process.exit(1); }' || fail "modules"

X -d '{"slug":"essai","name":"Essai","instanceId":"fake"}' $U/x/workspaces >/dev/null || fail "workspace"
docker run --rm -v workspace:/w busybox test -d /w/essai || fail "workspace folder not on the volume"
echo "OK   workspace created on the volume as uid 10000"

docker inspect --format '{{.State.Health.Status}}' intendia
for i in $(seq 1 15); do [ "$(docker inspect --format '{{.State.Health.Status}}' intendia)" = healthy ] && break; sleep 3; done
[ "$(docker inspect --format '{{.State.Health.Status}}' intendia)" = healthy ] || fail "healthcheck"
echo "OK   container healthy"
