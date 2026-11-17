#!/usr/bin/env bash
# Checks a running Intendia against its Hermes (fake or real): setup, compat, workspace, reads, one paused cron.
# Starts nothing. Env: U (Intendia URL), INST (instance id), LOGCMD (prints Intendia's log),
# WS_CHECK (succeeds when essai/AGENTS.md exists on the Hermes side), EXPECT_VERSION (optional Hermes version).
set -euo pipefail
: "${U:?}" "${INST:?}" "${LOGCMD:?}" "${WS_CHECK:?}"
J=$(mktemp)
fail() { echo "FAIL $*"; eval "$LOGCMD" 2>&1 | tail -40; exit 1; }
X() { curl -sf -b "$J" -H 'x-intendia: 1' -H 'content-type: application/json' "$@"; }
# J1 'expr': reads JSON on stdin as `j`, exits 1 when expr is falsy
J1() { node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); if (!(eval(process.argv[1]))) process.exit(1);' "$1"; }

for i in $(seq 1 30); do curl -sf "$U/x/health" >/dev/null && break; sleep 2; done
curl -sf "$U/x/health" | grep -q '"ok":true' || fail "health"
echo "OK   health: $(curl -s "$U/x/health")"

code=$(eval "$LOGCMD" 2>&1 | sed -n 's/.*Installation code: \([^ ]*\).*/\1/p' | head -1)
[ -n "$code" ] || fail "no installation code in the logs"
echo "OK   installation code in the logs"

# this route sets the session cookie: no /x/login (5 sign-ins per minute)
curl -sf -c "$J" -H 'x-intendia: 1' -H 'content-type: application/json' \
  -d "{\"code\":\"$code\",\"password\":\"mot-de-passe-de-test-ci\"}" "$U/x/setup/password" >/dev/null || fail "password"
echo "OK   password chosen"

for i in $(seq 1 30); do X "$U/x/compat" 2>/dev/null | grep -q '"modules"' && break; sleep 1; done
X "$U/x/compat" | EXPECT_VERSION="${EXPECT_VERSION:-}" node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf8")).reports[0];
  const bad = r.modules.filter((m) => m.state === "unavailable").map((m) => m.id);
  console.log("OK   modules: " + r.modules.map((m) => m.id + "=" + m.state).join(" "));
  if (bad.length) { console.log("FAIL unavailable: " + bad.join(", ")); process.exit(1); }
  const want = process.env.EXPECT_VERSION;
  const got = String(r.hermesVersion ?? "").replace(/^v/, "");
  if (want && got !== want) { console.log("FAIL Hermes version " + got + ", expected " + want); process.exit(1); }
  if (want) console.log("OK   Hermes version " + got);' || fail "compat"

X -d '{"slug":"essai","name":"Essai","instanceId":"'"$INST"'"}' "$U/x/workspaces" >/dev/null || fail "workspace"
eval "$WS_CHECK" || fail "workspace folder not written by the dashboard"
echo "OK   workspace created through the Hermes dashboard"

while IFS='|' read -r path expr; do
  X "$U/x/$path" | J1 "$expr" || fail "read $path ($expr)"
  echo "OK   read $path"
done <<READS
workspaces/essai/files/tree?path=|JSON.stringify(j).includes("AGENTS.md")
i/$INST/sessions/recent?limit=5|Array.isArray(j.sessions)
i/$INST/crons|Array.isArray(j.crons)
i/$INST/skills?profile=default|Array.isArray(j.skills)
i/$INST/config?profile=default|true
i/$INST/kanban/boards|Array.isArray(j.boards)
i/$INST/memory?profile=default|true
READS

# a refused creation prints Intendia's answer (Hermes' reason inside)
res=$(curl -s -w '\n%{http_code}' -b "$J" -H 'x-intendia: 1' -H 'content-type: application/json' \
  -d '{"name":"smoke-ci","prompt":"Ne rien faire.","deliver":"local","schedule":"0 3 * * *","paused":true}' "$U/x/i/$INST/crons")
created=$(echo "$res" | sed '$d')
[ "$(echo "$res" | tail -1)" = 201 ] || fail "cron create: HTTP $(echo "$res" | tail -1) $created"
id=$(echo "$created" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).cron.id)')
profile=$(echo "$created" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).cron.profile)')
X "$U/x/i/$INST/crons" | J1 "j.crons.some((c) => c.id === '$id')" || fail "cron $id not listed"
X -X DELETE "$U/x/i/$INST/crons/$id?profile=$profile" >/dev/null || fail "cron delete $id"
X "$U/x/i/$INST/crons" | J1 "!j.crons.some((c) => c.id === '$id')" || fail "cron $id still listed after delete"
echo "OK   cron created paused, listed, deleted"

echo "OK   all checks"
