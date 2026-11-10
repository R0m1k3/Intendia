# Hermes API notes (phase 0, Hermes Agent 0.23.0, 2026-09-24)

Observed on a reference install (official installer, isolated `HERMES_HOME`), recorded in `fixtures/hermes-0.23.0/`.

## API server (8642)

- `GET /v1/capabilities` returns `features` (flags) and `endpoints` (name → method + path) for runs, sessions,
  skills, toolsets, model options and health. Intendia resolves API server routes from this map.
- Auth: `Authorization: Bearer $API_SERVER_KEY`. With multi-profile routing, `/p/<profile>/...` uses that profile's key.
- `POST /v1/runs` accepts `input`, `instructions`, `session_id`; answers `{ run_id, status: "started" }`.
  The session id given is kept (`GET /v1/runs/{id}` shows it).
- `GET /v1/runs/{id}/events`: SSE, each event has `id:` and a `seq`; resume with `Last-Event-ID` or `?last_seq=`.
  Event types: `run.queued|started|completed|failed|cancelled|interrupted|stopping|steered`, `message.started|delta|interim`,
  `reasoning.available`, `tool.started|progress|completed|failed`, `approval.request|responded`,
  `subagent.start|complete`.
- `GET /api/jobs` works although `features.jobs_admin` is `false` and it is absent from `endpoints`.
- **Bug in 0.23.0**: `GET /v1/skills` answers HTTP 500 (`find_all_skills() got an unexpected keyword argument
  'include_editorial'`). The skills module uses the dashboard list first.

### Runs and sessions (checked 2026-11-09)

- `instructions` is added to the system prompt for that run only; `model` picks the route. Do not send `provider`:
  Hermes answers 400 when it contradicts a pinned model route.
- `GET /v1/runs/{id}` → `{object: "hermes.run", run_id, status, session_id, created_at, model, output, usage}`;
  `created_at` in seconds (float). Statuses: `queued`, `running`, `waiting_for_approval`, `stopping`, then
  `completed`, `failed`, `cancelled`, `interrupted`. Unknown run → 404 (also on `/events`, as JSON).
- SSE frames have no `event:` line: the type is the `event` field of the JSON; `id:` is the `seq`. A resume asking for
  events Hermes no longer keeps first gets `replay.truncated {oldest_retained_seq}`, then the rest.
- `approval.request` carries `choices` (`once`, `session`, `always`, `deny`) and sometimes `request_id`;
  answer with `POST /v1/runs/{id}/approval {choice, request_id}`.
- `GET /api/sessions` is paged (`limit`, `offset`, `has_more`). `GET /api/sessions/{id}` wraps the session in
  `{session}`. `GET /api/sessions/{id}/messages` → `{data: [{id, role, content, tool_calls, tool_name, timestamp}]}`,
  newest first, roles `session_meta|user|assistant|tool`. Unknown session → 404 `session_not_found`, on `DELETE` too.
- A run that fails before starting (no provider key) leaves no user message in the session.

## Dashboard (9119)

- Publishes an **OpenAPI 3.1** spec at `/openapi.json` (335 paths in 0.23.0). Intendia checks dashboard routes against it.
- Auth on a non-loopback bind: a provider is mandatory (`--insecure` is a no-op since June 2026).
  `HERMES_DASHBOARD_SESSION_TOKEN` (value or `file:<path>`) registers a token provider; send
  `Authorization: Bearer <token>` (WebSocket: `?token=`).
- Crons: `/api/cron/jobs` (+ `/pause`, `/resume`, `/trigger`, `/runs`, `/cancel`); list is a bare array.
- Profiles: `GET/POST /api/profiles` (**creation exists**), `PATCH/DELETE /api/profiles/{name}`, `/description`, `/model`, `/soul`.
- Skills: `GET /api/skills` (bare array), `PUT /api/skills/toggle`, `/api/skills/hub/{search,install,uninstall,update}`.
- Config: `GET/PUT /api/config`, `/api/config/schema` (`{ fields: { name: { type, description, category } } }`),
  `/api/config/defaults`, `/api/config/raw`.
- Env: `GET/PUT/DELETE /api/env`; values come back as `redacted_value`, sometimes partially visible
  (`«redacted:abcd...wxyz»`): **never display them**, show only "set / not set".
- MCP: `/api/mcp/servers` (GET/POST/PUT), `/{name}` DELETE, `/{name}/test`, `/{name}/enabled`; CLI equivalent
  `hermes mcp add <name> --url <http-url>`.
- Kanban: `/api/plugins/kanban/*` (board, boards, tasks, links, dispatch, orchestration, profiles...).
- Files: `/api/files` (list, read, download, upload, mkdir, delete) — a possible path for instances on another host.

## Official Docker image

`nousresearch/hermes-agent:latest`, data in `/opt/data`, uid/gid 10000 by default (`HERMES_UID`/`HERMES_GID`),
commands `gateway run` and `dashboard --host ... --no-open`.
