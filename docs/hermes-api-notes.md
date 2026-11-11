# Hermes API notes (phase 0, Hermes Agent 0.23.0, 2026-09-24)

Observed on a reference install (official installer, isolated `HERMES_HOME`), recorded in `fixtures/hermes-0.23.0/`.

## Hermes 0.23.1 (weekly CI recording, 2026-11-10)

`fixtures/hermes-0.23.1/` comes from the official image in an empty container: every module is complete,
nothing Intendia uses changed. New in the dashboard: `/api/gateway-connections/*` (remote gateways, OAuth, SSH)
and `/api/relay/{connection_id}/{path}`, not used by Intendia. Config: `approvals.approvers` added; `honcho`,
`sessions.cjk_fts` and `platform_toolsets.yuanbao` gone from the defaults. The other "shape changed" lines
of the diff are empty lists (no session, no cron in that container).

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

- `instructions` is added to the system prompt for that run only; `model` picks the route. `provider` is sent only
  with a model picked in a provider group of the chat (checked 2026-11-10: `_select_agent_runtime` uses the request
  provider first, so a model of another provider than the agent's works; without it the model goes to the agent's
  current provider). Hermes answers 400 when it contradicts a pinned model route (`model_routes`); a `/model` typed
  from a messaging platform in the same session wins over the request.
- `GET /v1/runs/{id}` → `{object: "hermes.run", run_id, status, session_id, created_at, model, output, usage}`;
  `created_at` in seconds (float). Statuses: `queued`, `running`, `waiting_for_approval`, `stopping`, then
  `completed`, `failed`, `cancelled`, `interrupted`. Unknown run → 404 (also on `/events`, as JSON).
- SSE frames have no `event:` line: the type is the `event` field of the JSON; `id:` is the `seq`. A resume asking for
  events Hermes no longer keeps first gets `replay.truncated {oldest_retained_seq}`, then the rest.
- `approval.request` carries `choices` (`once`, `session`, `always`, `deny`) and sometimes `request_id`;
  answer with `POST /v1/runs/{id}/approval {choice, request_id}`.
- `GET /api/sessions` is paged (`limit` up to 200, `offset`, `has_more`) and takes `source` (`telegram`, `cron`…); its
  `title` filter is an exact match, useless for a search.
- Search: dashboard `GET /api/sessions/search?q=&limit=(1..100)&profile=&source=` (not on the API server) looks for
  the id, then FTS5 in the messages; each result has `session_id`/`id`, `source`, `title`, `snippet` (hit between
  `>>>` and `<<<`, cut with `...`), `last_active`, `message_count`, `profile`. Empty `q` → `{results: []}`; a query
  FTS5 refuses → 500 « Search failed ».
- `GET /api/sessions` is paged (`limit`, `offset`, `has_more`). `GET /api/sessions/{id}` wraps the session in
  `{session}`. `GET /api/sessions/{id}/messages` → `{data: [{id, role, content, tool_calls, tool_name, timestamp}]}`,
  newest first, roles `session_meta|user|assistant|tool`. Unknown session → 404 `session_not_found`, on `DELETE` too.
- A run that fails before starting (no provider key) leaves no user message in the session.

### Run options and consumption (read in the 0.23.0 source, 2026-11-10)

- `POST /v1/runs` takes `model_options: {reasoning_effort}` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
  `max`, `ultra`; unknown values ignored, clamped to what the model accepts). It is not kept in the run status, so
  the only check from outside is that the request is accepted.
- Run status: `model` (asked for, or the default), `created_at` and usually `updated_at` (seconds). Only
  **completed** runs carry `usage` (`input_tokens` cache included, `output_tokens`, `total_tokens`,
  `cache_read_tokens`, `cache_write_tokens`; unknown counters are `0`) and `runtime {provider, model}` (the model
  that answered, differs after a fallback). One agent per run: `usage` is the run's own.
- Cost exists per session only, cumulated: `GET /api/sessions/{id}` → `estimated_cost_usd` / `actual_cost_usd`,
  `null` before anything is counted, `0` when the price is unknown. Written by a background queue: a read right
  after the end of a run may miss the last call.
- Compression: the session is closed (`end_reason: "compression"`) and the conversation goes on in a new one.
  `GET /api/sessions/{id}/messages` follows it and returns the live id in `session_id`; `GET /api/sessions/{id}`
  does not (the old total stays frozen); a run's status keeps the id it started on.

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
- A job may carry its own `timezone` (IANA name); its `next_run_at` is then written with that zone's offset, else with
  Hermes's. Cron expressions are read by croniter (day and month names, `7` = Sunday, day of month OR day of week
  when both are restricted).
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
5. `GET /api/model/options` can persist discovered models into the config (a read that writes). Models declared
   per provider live in `providers.<slug>.models` (a string, a list of strings or `{id|name}` objects, or a
   `{id: meta}` mapping; `_declared_model_ids`). For a built-in provider they are put first in its row and do not
   restrict the catalogue (`_lap_builtin_rows`); custom endpoints (`base_url`) use them as their list. No
   `max_models` cap on this route. `PUT /api/config` deep-merges mappings and replaces lists (`_deep_merge`).
   `explicit_only=true` (only explicitly configured providers) is understood by the dashboard, ignored by the API
   server.
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

## Provider accounts and API keys (checked on 0.23.0, 2026-11-11)

Kept per profile in the profile's `auth.json` (always pass `?profile=`), not in `config.yaml`.

1. `GET /api/providers/oauth` lists the providers with an account: `{id, name, flow: device_code|external,
   cli_command, docs_url, disconnectable, disconnect_hint, status: {logged_in, source_label, token_preview,
   expires_at, …}}`. On 0.23.0: `nous`, `openai-codex`, `minimax-oauth`, `xai-oauth` are `device_code`; `qwen-oauth`,
   `anthropic`, `claude-code` are `external` (CLI only: `start` answers 400 "uses an external CLI"). `token_preview`
   (part of a token) and `source_label` (can be a path of the Hermes server) are never shown.
2. Device-code login: `POST …/{id}/start` → `{session_id, user_code, verification_url, expires_in, poll_interval}`;
   `GET …/{id}/poll/{session_id}` (needs the dashboard token, despite its docstring; `wait=` makes it a long-poll)
   → `status: pending|approved|denied|expired|error|cancelled`, `error_message`, `model` (Nous may set the main model
   in `config.yaml` when approved). Hermes saves the tokens as soon as the login is approved, polled or not.
   `DELETE /api/providers/oauth/sessions/{id}` cancels and removes the session (a later poll is 404); an unknown
   session answers 200 `{ok: false}`. Sessions live in the dashboard's memory (15 min, purged on the next `start`).
   `DELETE /api/providers/oauth/{id}` disconnects (400 when not `disconnectable`).
3. `GET /api/credentials/pool` → `{providers: [{provider, entries: [{index (1-based), id, label, auth_type, source,
   last_status, token_preview, …}]}]}`. The pool also holds entries Hermes adds by itself: a key variable
   (`source: env:NAME`) and OAuth logins (`auth_type` other than `api_key`). `POST {provider, api_key, label?}` adds a
   `manual` key and answers `{ok, provider, count}`; on error the 400 detail is `str(exc)`, which may contain the
   key. `DELETE /api/credentials/pool/{provider}/{index}` removes by index and also cleans the entry's source for
   good (variable, OAuth file: `find_removal_step`): Intendia only removes `manual` keys, found by `id`.
4. A key added to the pool makes its provider `authenticated` at once in `/api/model/options` of both the dashboard
   and the API server, without restarting the gateway (checked with `deepseek`); removing it takes it out.

## Agents, kanban and sub-agents (checked on 0.23.0, phase 7, 2026-11-10)

Profiles (agents):
1. `GET /api/profiles` → `{profiles: [{name, is_default, model, provider, description, skill_count, gateway_running,
   has_env, path, ...}]}`; `GET /api/plugins/kanban/profiles` gives a shorter copy of the same list.
2. `POST /api/profiles {name, description?, clone_from?, ...}` creates a profile; name `^[a-z0-9][a-z0-9_-]{0,63}$`,
   reserved names refused (400 with a message). It also accepts `provider`, `model`, `api_key`, `mcp_servers`: Intendia
   never sends them.
3. `PATCH /api/profiles/{name}` **renames** the profile (`{new_name}`). The description goes through
   `PUT /api/profiles/{name}/description {description}` or `PATCH /api/plugins/kanban/profiles/{name} {description}`.
4. `GET /api/profiles/{name}/soul` → `{content}` (SOUL.md). It may quote tokens: Intendia masks it (`Masker.text`).
5. A new profile has no API server key in Intendia: no chat with it until its key is added to `profileKeys`.

Kanban (`/api/plugins/kanban/...`):
6. One kanban for **every profile** (database under the Hermes root): no `?profile=`. The "current board" is global
   (`POST /boards/{slug}/switch` changes it for the dashboard, the CLI and the agents): Intendia always passes
   `?board=` and never switches. Every route accepts `?board=`; an unknown board is a 404.
7. `GET /boards` → `{boards: [{slug, name, archived, is_current, total, counts}], current}`; `POST /boards {slug, name?}`
   returns the existing board when the slug exists.
8. `GET /board?board=` → `{columns: [{name, tasks}], assignees, latest_event_id, now}`; task ids `t_xxxxxxxx`, dates in
   seconds. `GET /workflow` → `columns` and `manual` (allowed manual moves per status). Moving to `running` by hand, or
   to `done` with an unfinished parent, is a 400.
9. `POST /tasks {title, body?, assignee?, priority?, triage?, workspace_kind?, workspace_path?, parents?}`: without
   `triage: true` the task starts in `ready` and the dispatcher launches it if it has an assignee (a task without
   assignee is never launched: `skipped_unassigned`). With `auto_decompose` (on by default) the gateway splits
   `triage` tasks and launches the pieces when an auxiliary model answers. **`todo` is not idle**: it means
   "waiting for its parents"; `recompute_ready` (after writes and on each dispatcher tick) promotes a `todo` task
   whose parents are all done to `ready` (seen within 15 s on the reference instance), and a non-sticky `blocked`
   one too. `link_tasks` sends a `ready` child of an unfinished parent back to `todo` (`gated: true`).
   **`scheduled` is the idle state**: only an explicit unblock (a move to `ready`, which re-checks the parents)
   takes a task out of it; `schedule_task` accepts `todo`, `ready`, `running`, `blocked` (from `triage`: 409). A
   block set through `PATCH {status: "blocked"}` (`block_task`, from `ready`/`running` only) is sticky: not
   promoted back. Checked 2026-11-10: a task created `ready` without assignee, then `scheduled`, then assigned,
   was still `scheduled` after 70 s.
10. `PATCH /tasks/{id} {status?, assignee?, priority?, title?, body?, block_reason?}`; transition errors are 400
    `{detail}`. `POST /tasks/{id}/specify|decompose` call an auxiliary model; without one: 200 `{ok: false, reason}`.
11. `POST /dispatch?board=&dry_run=&max=` (default `max` 8); Hermes also dispatches by itself every 60 s.
12. `GET/PUT /orchestration {orchestrator_profile, default_assignee, auto_decompose, auto_promote_children}`; the `GET`
    adds `active_profile`, whose `config.yaml` the `PUT` rewrites.
13. `GET /workers/active?board=` → `{workers: [{run_id (integer), task_id, task_title, task_status, task_assignee,
    profile, worker_pid, started_at}], count}`.
14. `POST /runs/{run_id}/terminate?board= {reason?}` kills the worker and puts the task back in **`ready`** (the
    dispatcher relaunches it) or `review`. Unknown run: 404 `run N not found` (seen on the reference instance); run
    already ended: 409. Intendia's "Stop" blocks a task found in `ready` afterwards (`block_reason`).
15. WebSocket `/api/plugins/kanban/events?board=&since=&token=` (dashboard token in the query, not in `/openapi.json`):
    `{events: [{id, task_id, run_id, kind, payload, created_at}], cursor}`; unknown or archived board: close 1008.

16. `GET /tasks/{id}` → `{task, comments, events, attachments, links, link_tasks, child_results, runs}`.
    `GET /tasks/{id}/log` → `{task_id, path, exists, size_bytes, content, truncated}`: the worker's raw output, which
    may quote tokens (Intendia keeps the last 200 lines, masks them and drops `path`, a path on the Hermes host).
    `GET /attachments/{id}` returns the file.
17. On that WebSocket a good token opens at once and messages come only when the board changes. A **wrong token
    gets no answer** to its handshake: neither open nor close (still pending after 6 s, checked 2026-11-10).
    Intendia gives up after 10 s (`OPEN_TIMEOUT_MS`) and the page falls back to polling.

Sub-agents and runs (API server):
18. A run's event stream carries `subagent.start` and `subagent.complete` with `subagent_id`, `parent_id`, `depth`,
    `goal`, `model`, `status`, `summary`, `duration_seconds`, `cost_usd`, `input_tokens`, `output_tokens`,
    `tool_count` (absent when unknown). Opened without `last_seq`, the stream replays what Hermes kept of the run. The
    session history (`/v1/sessions/{id}/messages`) has no sub-agent events.
19. There is **no run list**: only `GET /v1/runs/{id}`, kept in memory (404 after a Hermes restart).

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

