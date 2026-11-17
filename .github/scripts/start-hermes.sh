#!/usr/bin/env bash
# Starts the official Hermes image IMAGE (gateway on 8642, dashboard on 9119) on a fresh `hermes-data`
# volume, without any AI provider key. Env: API_KEY, DASH_TOKEN.
set -euo pipefail
IMAGE=${1:?usage: start-hermes.sh IMAGE}
: "${API_KEY:?}" "${DASH_TOKEN:?}"

docker volume create hermes-data >/dev/null
# keys in the .env of HERMES_HOME: the s6-supervised gateway of recent images does not see `docker run -e`;
# /opt/data/workspace is the dashboard's managed files root, owned by the image's user (10000)
printf 'API_SERVER_ENABLED=true\nAPI_SERVER_HOST=0.0.0.0\nAPI_SERVER_KEY=%s\nHERMES_DASHBOARD_SESSION_TOKEN=%s\n' "$API_KEY" "$DASH_TOKEN" \
  | docker run --rm -i -v hermes-data:/opt/data busybox sh -c \
    'cat > /opt/data/.env && chown 10000:10000 /opt/data/.env && chmod 600 /opt/data/.env && mkdir -p /opt/data/workspace && chown 10000:10000 /opt/data/workspace'
docker run -d --name hermes-gw -v hermes-data:/opt/data -p 8642:8642 \
  -e API_SERVER_ENABLED=true -e API_SERVER_HOST=0.0.0.0 -e API_SERVER_KEY="$API_KEY" \
  "$IMAGE" gateway run >/dev/null
docker run -d --name hermes-dash -v hermes-data:/opt/data -p 9119:9119 \
  -e HERMES_DASHBOARD_SESSION_TOKEN="$DASH_TOKEN" -e HERMES_DASHBOARD_FILES_ROOT=/opt/data/workspace \
  "$IMAGE" dashboard --host 0.0.0.0 --no-open >/dev/null

for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8642/health >/dev/null && curl -s -o /dev/null http://127.0.0.1:9119/; then
    echo "OK   Hermes $IMAGE up (gateway :8642, dashboard :9119)"
    exit 0
  fi
  sleep 5
done
echo "FAIL Hermes $IMAGE did not answer within 5 min (if the tag is gone from Docker Hub, move the fixtures forward)"
docker logs hermes-gw 2>&1 | tail -40
docker logs hermes-dash 2>&1 | tail -20
exit 1
