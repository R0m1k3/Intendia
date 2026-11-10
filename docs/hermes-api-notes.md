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

## Crons (checked on 0.23.0, phase 4, 2026-11-09)

- Source: the dashboard (`/api/cron/*`, in its OpenAPI). The API server answers `/api/jobs` too (`{ jobs }`,
  `PATCH` with flat fields, `{ job }` replies, `POST /api/jobs/{id}/run`) but announces `jobs_admin: false` and has
  no runs, no cancel, no delivery targets. Intendia uses the dashboard first, the API server as a fallback.
- Every cron route takes `?profile=`; the list defaults to `all`, the others to the active profile. Unknown profile:
  404 `Profile 'x' does not exist.`; job not in that profile: 404 `Job not found`.
- Create (`CronJobCreate`): `schedule` required; `name`, `prompt`, `deliver` (default `local`), `skills[]`, `model`,
  `workdir`, `paused`. Update: `PUT` with `{ "updates": { ... } }`. `updates.paused: false` does **not** resume a job
  (use `/resume`); `updates.workdir: null` clears it.
- `schedule` strings: `every 30m`, `every 2h`, `in 30m` (once), `0 9 * * *`, `2026-11-12T08:30:00` (once, Hermes
  time zone), plus English phrases (`weekdays at 9am`) Intendia does not send. Invalid: 400
  `{"detail":"Invalid schedule 'x'. Use: ..."}`. Replies carry `schedule: { kind: interval|cron|once, minutes | expr | run_at, display }`
  and `schedule_display`.
- A job also carries `hermes_home`, `script`, `monitor_*`, `origin`: never sent to the browser.
- `last_run_at` / `last_status` (`ok`, `error`, `delivery_failed`, `cancelled`, `blocked_config`...) are written only
  when a run ends (`cron/jobs.py`, `_record_run_outcome`): a change of `last_run_at` means the run is over.
- `GET .../runs?limit=` answers `{ runs }`; each run is a Hermes session (`id`, `started_at`/`ended_at` in seconds,
  `message_count`, `tool_call_count`, `estimated_cost_usd`). A run blocked before starting keeps `ended_at: null`.
  The run's text output goes to a Hermes file with no HTTP route.
- `trigger` answers the job at once (a blocked run is already recorded in that reply); `cancel` answers
  `{ success, cancelled, detail }`.
- `GET /api/cron/delivery-targets`: `{ targets: [{ id, name, home_target_set }] }`.

## Skills (checked on 0.23.0, phase 5, 2026-11-09)

- `GET /api/skills` lists disabled skills too: `[{ name, description, category, enabled, locked, usage, provenance }]`,
  `provenance` in `bundled | hub | external | agent`. A `name` may be a relative path (same-tier duplicate).
- Every `/api/skills/*` and `/api/tools/toolsets` route takes `?profile=`; an unknown profile is a 404
  `Profile 'x' does not exist.`
- `PUT /api/skills/toggle {name, enabled}` accepts an unknown name (200) and stores it in the disabled list.
- `GET /api/skills/content?name=` → `{ name, content, path }` (`path` is a path on the Hermes host); 404 if absent.
- `GET /api/tools/toolsets` → bare array `{ name, label, description, enabled, available, configured, tools[] }`;
  `/v1/toolsets` has the same in `{ data }` with an emoji at the start of `label`.
- No route links a skill to tools; a few SKILL.md declare `requires_toolsets` in their front matter.
- `GET /api/skills/hub/official` → `{ skills: [... , category, installed] }` (local catalogue, fast).
  `GET /api/skills/hub/search?q=&source=&limit=` (limit capped at 50) → `{ results, source_counts, timed_out,
  installed: { identifier: lock entry } }`, about 10 s (network, 30 s internal timeout); empty `q` → empty answer.
- `GET /api/skills/hub/scan?identifier=` downloads the bundle (about 2 s for an official skill) → `{ verdict:
  safe|caution|dangerous, policy: allow|ask|block, policy_reason, summary, findings[], severity_counts, trust_level }`;
  404 for an unknown identifier. `GET /api/skills/hub/preview` gives `skill_md` and `files` (not used).
- `POST /api/skills/hub/{install {identifier}, uninstall {name}, update}` spawn `hermes [-p profile] skills ... --yes`
  and answer `{ ok, pid, name }` at once. `name` = `skills-<verb>-<slug>-<sha1(key)[:8]>` (slug: lower case,
  non-`[a-z0-9]` runs → `-`, trimmed, 48 chars, `skill` if empty) or `skills-update`; it does not include the profile.
  Hermes keeps one process and one appended log per name (each run starts with `=== <name> started <date> ===`).
- `GET /api/actions/{name}/status?lines=` (default 200) → `{ name, running, exit_code, pid, lines }`; 404
  `Unknown action` for a name this dashboard process never started (the table is in memory).
- `--yes` skips Hermes' confirmation, not its scan: `block` is refused (`Installation blocked`), `ask` installs.
  Uninstalling a non-hub skill exits 1 (`Error: '<name>' is not a hub-installed skill`); an unknown identifier exits 1
  (`Error: Could not download ...`).

## Settings (checked on 0.23.0, phase 6, 2026-11-09)

1. `GET /api/config` masks nothing: `${VAR}` references come back resolved (secret values included).
   `?include_defaults=false` returns the file as written. `GET /api/config/schema` → `{ fields: { path: { type,
   description, category, options? } }, category_order }`; every field whose default is `None` is typed `string`
   (e.g. `agent.max_turns` holds 500).
2. `PUT /api/config {config}` deep-merges into the file; a `null` over a section is ignored, over a scalar it
   replaces the value.
3. `GET /api/config/raw` → `{ yaml, path }`. `PUT /api/config/raw {yaml_text}` replaces the content but writes it the
   Hermes way: it keeps the comments and layout of the file on disk and drops comments added in the text sent.
   In the raw file `model` is a table.
4. `PUT /api/env {key, value}` and `DELETE /api/env {key}` also rewrite copies of the value in `config.yaml`; the MCP
   writes call `save_config` too. `GET /api/env` sometimes shows the start and end of a value (`redacted_value`):
   never display it, never call `/api/env/reveal`.
5. `GET /api/model/options` can persist discovered models into the config (a read that writes).
6. `POST /api/model/set {scope, provider, model, task?, confirm_expensive_model?}`: with `api_key` it writes the key in
   clear in the config (Intendia never sends `api_key` nor `base_url`). An expensive model answers 200
   `{ ok: false, confirm_required, confirm_message }`.
7. `POST /api/mcp/servers` needs `auth: "header"` with `bearer_token`; the token goes to the env file as
   `MCP_<NAME>_API_KEY` (name upper-cased, `-` → `_`). Deleting the server may leave it: Intendia deletes it after.
   `POST /api/mcp/servers/{name}/test` can take 30 s or more.
8. `GET /api/messaging/platforms` → states are not a closed list (`disabled`, `not_configured`, `pending_restart`,
   `connected`...); `error_message` may quote a token.
9. `POST /api/gateway/restart` runs `hermes gateway restart --interrupt` (running turns are cut, for every profile the
   gateway serves); follow it with `/api/actions/gateway-restart/status` (log header `=== gateway-restart started`).
10. Writes are not versioned by Hermes: there is no ETag; Intendia compares a SHA-256 of the raw text.
11. PyYAML reads `.` and `1e5` as strings; the `yaml` library in 1.1 mode reads them as NaN and 100000 unless its
    float tags are narrowed (`pyTags` in `hermes-config/mask.ts`).

Masking risks: secrets are found by key name, by section (`mcp_servers.*.headers|env`, `extra_headers`) and by value
shape (token prefixes, Telegram tokens, URL passwords, query values, webhook paths). A secret with an ordinary key and
an ordinary look would stay visible; a new Hermes section holding secrets needs a rule.

## Official Docker image

`nousresearch/hermes-agent:latest`, data in `/opt/data`, uid/gid 10000 by default (`HERMES_UID`/`HERMES_GID`),
commands `gateway run` and `dashboard --host ... --no-open`.

## MCP client (checked on 0.23.0, phase 3)

- Hermes speaks Streamable HTTP to `mcp_servers.<name>.url` and sends `mcp_servers.<name>.headers` on every request.
  Before connecting it probes the URL with `HEAD` (then `GET` on 405/501) and only gives up on a 2xx with a non-MCP
  content type, after one more `POST initialize` try. Intendia answers 405: the probe passes.
- The default mode tries `initialize` first, offering `2025-11-25` (handshake versions known: `2024-11-05`, `2025-03-26`,
  `2025-06-18`, `2025-11-25`), and only falls back to `server/discover` (the stateless `2026-07-28` era) on -32022 or on
  -32601 for `initialize`.
- Dashboard: `POST /api/mcp/servers` accepts `{name, url, auth: "header", bearer_token}` (without `auth: "header"` a
  bearer token is refused) and stores the token in Hermes's `.env` as `MCP_<NAME>_API_KEY`, referenced from the headers;
  `POST /api/mcp/servers/{name}/test` connects, lists the tools and disconnects; `DELETE /api/mcp/servers/{name}`.

