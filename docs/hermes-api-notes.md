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
  `reasoning.available`, `tool.started|progress|completed|failed`, `approval.request|responded|settled`,
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
- Approvals come in two formats (read in the 0.23.0 source, not seen live: no provider key on the reference instance):
  - **gateway session authority** (the normal case of 0.23: the gateway always creates it, `gateway/run_bootstrap.py`):
    `approval.request {prompt_id, execution_generation, command, description, choices}`, end `approval.settled
    {prompt_id, execution_generation}`; `GET /v1/runs/{id}` gives `execution_generation` and `pending_controls` (the
    same prompts); the answer must be exactly `{request_id: <prompt_id>, execution_generation, choice}`, any other key →
    `invalid_params`, another generation → `stale_generation`, `choice` must be one of the prompt's `choices`
    (`gateway/platforms/api_server_authority_runs.py` `respond_run`). The run status says `waiting_for_approval`.
  - **without authority** (branch `else` of `_handle_run_approval`): `approval.request` with `choices` and sometimes
    `request_id`, end `approval.responded`, answer `{choice, request_id?}`.
  Intendia builds the body on the server from the run status (`controlBody` in `routes/chat.ts`); the fake uses the
  authority format, `FAKE_CONTROLS=legacy` the other.
  A page id no longer pending is refused (409 `no_pending`), never replaced by another prompt.
- Questions of the agent (clarify tool), authority only (read in the 0.23.0 source): `clarify.request {prompt_id,
  execution_generation, question, choices, multi_select}`, end `clarify.settled`; answer `POST /v1/runs/{id}/clarify
  {request_id, execution_generation, answer}` (a string; several choices = a JSON array of the labels,
  `tools/clarify_gateway.py`). Route not in `/v1/capabilities`; without the authority Hermes answers 409 `not_found`
  (Intendia: 409 `clarify_unavailable`). A run waiting on a question stays `running`; the question is also in
  `pending_controls` (`kind: "clarify"`).
- Reorientation: `POST /v1/runs/{id}/steer {input}` (`run_steer`), only while the status is exactly `running` (else 409
  `run_not_accepting_steer`, also during an approval); given to the agent after its current tools. `run.steered`
  carries only `accepted`, not the text. A text never delivered comes back as `pending_steer` on the final event and in
  the status; a delivered one is a `user` line with `display_kind: "steer"` in the messages.
- Dashboard JSON-RPC WebSocket `/api/ws?token=<dashboard token>` (outside the OpenAPI; `?token=` accepted in
  loopback / `--insecure`, an authenticated dashboard needs a user ticket Intendia has not): frames `{jsonrpc, id,
  method, params}`, pushed events have no `id`. `session.stats {session_id}` → `context_tokens`, `context_length`,
  `plan_gauge {label, used_bp, resets_at_ms}`, `tokens_per_s` (`gateway/session_usage.py`; 0 / null before the agent's
  first turn) **only when the dashboard runs inside the gateway**: a standalone dashboard (reference instance, the
  usual setup) answers `-32601 unknown method`. `commands.catalog` and `session.list` answer in both cases;
  `session.resume` copies the session into the dashboard's process (never call it).
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
- Session titles are unique (`idx_sessions_title_unique`, checked 2026-11-12): a rename to a title in use → 400
  `invalid_title` « already in use by session … »; an import with one fails the whole write as 503
  `storage_unavailable` (gateway log: `UNIQUE constraint failed: sessions.title`). Hermes numbers its own « title #2 ».
  Intendia imports copies untitled, then sends the title, numbered « #N » at Hermes when taken (`workspaces/title.ts`).
- `llm.oneshot {instructions, input, task, max_tokens, profile?}` on the dashboard WebSocket answers on a standalone
  dashboard too: `{text}`, 4030 for empty params, 5030 when no model is set for the task (« Titre par l'IA »).

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
    `{detail}`. There is **no `block_reason` column** (checked 2026-11-12, `explore9`): the reason of `blocked` /
    `scheduled` becomes the summary of a synthetic run, read back as `latest_summary` (task detail and board).
    `PATCH archived` is accepted from any state (stops the worker) and counts as finished for the children;
    `PATCH ready` on a `scheduled`/`blocked` task goes through `unblock_task`: `todo` while a parent is unfinished.
    `decompose` answers `{ok, task_id, reason, fanout, child_ids, new_title}`: the children become the **parents**
    of the root (the root waits for them) and, with `auto_promote_children`, `ready` at once; the dispatcher's
    `recompute_ready` (60 s) promotes `todo` anyway, so only `scheduled` holds them. Between the split and Intendia's
    `PATCH scheduled` the dispatcher may take a child (short window, not measured): Intendia leaves a running child
    alone and shows it. `POST /tasks/{id}/specify|decompose` call an auxiliary model; without one: 200 `{ok: false, reason}`.
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

## Managed files (read in the 0.23.0 source, `web_routers/files.py`, `web_server_files.py`; same routes in 0.23.1)

- Root per process (`locked_root` in every answer): `HERMES_DASHBOARD_FILES_ROOT` if set, else `/opt/data` in the
  official image (it holds the configuration and the keys), else none (any absolute path).
- `GET /api/files?path=` → `{path, parent, entries:[{name, path, is_directory, size, mtime, mime_type, broken_link?}],
  root, locked_root, can_change_path}`. Relative paths are relative to the root, `..` → 400, outside → 403. Paths are
  resolved (links followed): an entry whose resolved path leaves the root makes the whole listing fail with 403; a
  broken link is listed with `broken_link: true` and its own (unresolved) path; `size`/`mtime` (seconds, float) are
  null for folders or broken links.
- Hidden from listings and downloads (case-insensitive): `.env`, `.env.*`, `.envrc`, `auth.json`, `auth.lock`,
  `credentials`, `config.yaml`, OAuth caches, `.git-credentials`, anything under `mcp-tokens/` or `pairing/`.
  **Writes to these names are not blocked.**
- `GET /api/files/download?path=` (100 MiB, Range supported); `POST /api/files/upload-stream` multipart `file`, `path`,
  `overwrite` (default true; false + existing → 409), parents created, temporary file then `os.replace`: an existing
  link is followed (its target is replaced), a broken link is replaced by the file. `POST /api/files/mkdir {path}`
  (parents, idempotent, 409 if a file has that name). `DELETE /api/files {path, recursive}` (follows a link, 404 on a
  broken one, 409 for a non-empty folder without `recursive`, 400 on the root).
- No rename or move, no stat route. `GET /api/fs/*` (files of the agent's machine) has no locked root: not used.

## Git (read in the 0.23.0 source, `web_routers/git.py`, `web_git.py`; same routes in 0.23.1)
- `GET /api/fs/git-root?path=` walks up to 50 parents looking for a `.git` entry (folder or file) and returns `{root}` (resolved) or null; it can leave the managed files root.
- Every `/api/git/*` route takes an absolute `path`, resolved (links followed) but **not confined to the managed files root**, except `review/diff`, `file-diff` and `review/commit-context` (403 outside the root and for credential files). git runs with `path` as its working folder, hooks and fsmonitor off, global config ignored, no password helper; SSH in `BatchMode`; 30 s per command. Write errors: 400 with git's stderr in `detail`.
- `status` → `{branch, defaultBranch, detached, ahead, behind, staged, unstaged, untracked, conflicted, changed, added, removed, files[≤200]: {path, staged, unstaged, untracked, conflicted}}` or null (counts = numbers of files; nothing says whether the branch has an upstream). `review/list?scope=uncommitted` → `{files: [{path, added, removed, status, staged}]}`, not cut; `staged` = index code set; git runs without `-uall`: an untracked folder is one `folder/` line.
- `review/diff?file=&scope=uncommitted&staged=` (literal pathspec; `staged=false` on a file with no unstaged change gives a misleading all-add diff), `file-diff?file=` (worktree against HEAD), `branches` → `{branches: [{name, checkedOut, isDefault, isRemote, worktreePath}]}`, `review/commit-context` → `{diff (120 000 characters, credential files removed), recent: string}`.
- Writes (POST, `{path, …}`): `review/stage|unstage {file?}` (`file` is a git **pathspec**: `*` matches; without `file`: `add -A` / `reset`), `review/revert {file?}` = `checkout HEAD -- f` + `clean -fd -- f`, errors ignored, **always `{ok: true}`**; `review/commit {message, push}` runs `add -A` first **when nothing is staged**; `review/push` (`push -u origin <branch>` without upstream); `branch/switch {branch}`. No pull, no fetch. `ship-info` / `create-pr` (gh) and `worktree/*` are not used.
- `llm.oneshot` (dashboard WebSocket) has a `commit_message` template: `{template: 'commit_message', variables: {diff, recent_commits, avoid}}` (unknown template → 4031).

## Usage, logs and host metrics (read in the 0.23.0 source, checked on 0.23.0, 2026-11-12; same routes in 0.23.1)

- `GET /api/analytics/usage?days=&profile=` (1-365, else 422): `daily`, `by_model`, `by_task`, `totals`, `skills`,
  `tools`. Window = sessions started in the last `days`; costs = sums of the session costs (null counts 0, written
  late, 0 when the price is unknown). Sums can be `null` on an empty window. One profile per call.
- `GET /api/sessions/stats?profile=`: `{total, archived, messages, by_source}` (no period, no cost).
- `GET /api/logs?file=&lines=&level=&component=&search=&profile=`: files `agent, errors, gateway, gui, desktop,
  update, handoff, mcp` (other → 400), `lines` ≤ 500, `level` = minimum, `component` in `gateway, agent, tools, cli,
  cron, gui` (else 400), `search` = substring over the last 2000 lines. Lines are raw text **with their newline**.
  `mcp-stderr.log` (stdio MCP servers' stderr), update and desktop logs are **not** redacted by Hermes.
- `GET /api/system/stats` (no profile): identity, `hostname`, CPU, memory, disk of the Hermes home, load, uptime,
  dashboard process; without psutil only identity and load. In a container: the host's values.

## Gateway and profiles (read in the 0.23.0 source, checked on 0.23.0, 2026-11-12)

- `POST /api/gateway/start|stop?profile=` (`stop` takes `interrupt=true`) spawn `hermes -p X gateway start|stop` as
  actions `gateway-start` / `gateway-stop` (`/api/actions/{name}/status`). 409 when the profile is served by the
  multiplexer, then (stop) when sessions are live. On the reference bench a non-default profile is "parked" by stop
  ("its bots and cron are stopped") and "served by the host gateway" again by start. In the Docker image a stopped
  gateway stays down after a container restart; the API server of that profile is down with it.
- `DELETE /api/profiles/{name}` = `rmtree` of the profile (waits ≤ 10 s for its gateway), `{ok, path}` or
  `{settlement_pending, retry_command}`; no `?profile=` needed. `default` is refused.
- `PUT /api/profiles/{name}/soul {content}`, `PUT /api/profiles/{name}/model {provider, model}` (400 when the
  provider is not connected), `POST /api/profiles/{name}/describe-auto {overwrite}` → `{ok, reason, description}`
  (auxiliary model; refuses over a user-written description). Create (`POST /api/profiles`) also takes `clone_all`,
  `no_skills`, `soul`, `provider` + `model` (a refused model is `model_error`, the profile is created).

## Writing skills, advanced cron options, cron templates (read in the 0.23.0 source, checked on 0.23.0, 2026-11-12)

- `POST /api/skills?profile= {name, content, category?}` writes `skills/<category>/<name>/SKILL.md`; name
  `^[a-z0-9][a-z0-9._-]{0,63}$`, description of the front matter ≤ 60 characters, 400 « already exists at <host path> »
  (Intendia hides the path). The new skill has `provenance: agent`, like the ones the agent writes.
- `PUT /api/skills/content {name, content}` rewrites the whole SKILL.md; `PUT /api/skills/lock {name, locked}`: the
  agent and the curator may no longer edit it (the user still can).
- Removal = archive: `DELETE /api/learning/node?profile= {id: <name>, profile}` moves it to `skills/.archive`
  (restore: `hermes curator restore`, no HTTP route). Refused for pinned, hub, bundled and external skills; Intendia
  only offers it for `provenance: agent`.
- Cron fields: `repeat` (`{times, completed}` on read; a number, `"forever"` or `"once"` on write), `timezone`,
  `enabled_toolsets` (`[]` = no tool at all: never sent, `null` = every toolset), `catch_up`, `grace_minutes`,
  `context_from` (ids of crons of the same profile). On update `null` brings back Hermes' default.
- `GET /api/cron/blueprints?profile=` → `{blueprints: [{key, title, description, category, tags, fields,
  scheduleHuman, source, plugin, command, appUrl}]}`; 16 builtin templates on 0.23.0. Field types `time`, `enum`,
  `text`, `weekdays` (`everyday`, `weekdays`, `weekends`); `options` are strings; `strict: false` (the `deliver`
  field) = options are suggestions only. `POST /api/cron/blueprints/instantiate?profile= {blueprint, values}` creates
  the cron (no `?profile=` = `default`, not the active profile); 422 with a text `detail` for an unknown field, a
  missing value or a value outside a strict list. The cron has no workdir: Intendia frames it afterwards with a `PUT`.

## Memory and learning graph (read in the 0.23.0 source, checked on 0.23.0, 2026-11-12)

- `GET /api/memory?profile=` → `{active, providers, builtin_files: {memory, user}}` (sizes in bytes, 0 when the file
  is missing). `GET /api/learning/graph?profile=` → `{nodes, edges, clusters, memory, stats}`: memory cards (title =
  first line, 80; body = first 1200 characters; fingerprint = sha256 of the entry, 12 hex), learned skills only
  (written by the agent or used; not the bundled repository), skill→skill and memory→skill edges.
- `GET /api/learning/node?id=` → `{kind, id, label, content}`; 404 « memory node id is stale — refresh the graph » when
  the entry changed. `PUT /api/learning/node {id, content, profile}`: 400 for stale, empty (« use delete »), over the
  file's limit (« Replacement would put memory at N/L chars »). `DELETE /api/learning/node {id, profile}` (JSON body)
  removes a memory entry (no copy kept) or archives a skill. No route adds an entry.

## MCP catalog and dashboard OAuth (read in the 0.23.0 source, checked on 0.23.0, 2026-11-12)

- `GET /api/mcp/catalog?profile=` → `{entries: [{name, description, source (doc URL), transport, auth_type, required_env:
  [{name, prompt, required}], command, args, url, needs_install, post_install, installed, enabled…}], diagnostics}`
  (66 entries on 0.23.0, all http, 56 OAuth).
- `POST /api/mcp/catalog/install?profile= {name, env, enable}`: undeclared env names → 400; secret values go to the
  profile `.env`; an entry with a git install answers `{background: true, action}`, else `{background: false}`.
- `POST /api/mcp/servers/{name}/auth?profile=`: http server only (stdio / header auth 400, plugin 409, unknown 404), one
  flow per server (409), 8 at most (429); waits ≤ 30 s for `{flow_id, server_name, status, authorization_url, error}`.
  Return URL = `mcp_servers.<name>.oauth.redirect_uri`, else `HERMES_DASHBOARD_PUBLIC_URL` / `dashboard.public_url`,
  else the request's base URL. `GET|DELETE /api/mcp/oauth/flows/{flow_id}` (GET adds `tools`; DELETE idempotent).
- `GET /api/mcp/oauth/callback/{server_name}?code&state&error&iss`: public path (no token), matches the waiting flow by
  server and `state`; 404 HTML when none; then Hermes exchanges the code (a fake code ends the flow in `error`,
  `invalid_grant`). `PUT /api/config {config: {mcp_servers: {<name>: {oauth: {redirect_uri}}}}}` merges into the entry
  (url kept): checked on 0.23.0 with `airtable`.

## Agent plugins (read in the 0.23.0 source, checked on 0.23.0, 2026-11-12)

- `GET /api/dashboard/plugins/hub` → `{plugins: [{name, version, description, source (bundled|user|git|pip), runtime_status
  (enabled|inactive|disabled), path (host path), can_remove, can_update_git, auth_required, auth_command, user_hidden,
  removed_reason}], orphan_dashboard_plugins, providers}`. Reference instance: 64 bundled plugins, none removable.
- `GET /api/dashboard/plugins/catalog` → `{entries: [{name, repo, sha (40 hex), title, description, maintainer, tier
  (official|verified|community), category, requires_hermes, docs_url, version, platforms, capabilities {provides_tools,
  provides_hooks, provides_middleware, requires_env}, known_issues, sha_short, installed, installed_sha, update_available,
  runtime_status, readme, screenshots…}], removed: [{name, repo, reason, date}], generated_at}`: 1050 entries on 0.23.0,
  some descriptions are a whole README (29 kB).
- `POST /api/dashboard/agent-plugins/install {identifier, ref, catalog_name, enable, force}`: synchronous (clone + pip),
  `{ok, plugin_name, warnings, python_dependencies, missing_env, enabled, gateway_reloaded, restart_required,
  known_issues}`; only `consent_required` comes back as 200 with `ok: false`, any other failure (scan included) is 400
  `{detail}`. `POST …/{name}/enable|disable`, `DELETE …/{name}` (`{name:path}`, `..` and backslashes refused). None takes a profile.
- `POST …/{name}/update` pulls the repository (not the catalog's commit) and may answer `consent_required` /
  `scan_blocked`: not used by Intendia.

## Background sub-agents (read in the 0.23.0 source, 2026-11-12)

- For a session of the API server (`/v1/runs` with `session_id`), `delegate_task` runs in the background
  (`tools/delegate_tool_dispatch.py`): the tool result is a ticket `{status: "dispatched", mode: "background", count,
  delegation_id, goals, note, units?: [{delegation_id, group, task_indexes}], refused?: [{task_index, error}]}`; the run
  ends. SSE `subagent.start` carries `goal, task_index, task_count, subagent_id, child_session_id, delegation_id,
  parent_id, depth, model`; the `subagent.complete` of a background child comes after the run (never in the stream).
- At the end Hermes starts **no turn** (`gateway/wake.py`): it adds a row `role: "user"`,
  `display_kind: "async_delegation_complete"` to the session (never during an active turn; on the live session after
  a compression) and gives it to the model with the next user message. One row per `delegation_id` (+ `delivery_notice`
  for an early failure). With `delegation.independent_completions`, one row per unit (`<id>-<k>`).
- `GET /api/sessions/{id}/messages` does **not** serve `display_metadata` (`_message_response` keeps `id, session_id,
  role, content, tool_call_id, tool_calls, tool_name, timestamp, token_count, finish_reason, reasoning,
  reasoning_content, display_kind`). The text (`tools/process_registry_notifications.py`) gives the id in its header
  (`[ASYNC DELEGATION COMPLETE — <id>]`, `[ASYNC DELEGATION BATCH COMPLETE — <id>]`, `[ASYNC DELEGATION TASK FAILED —
  <id>, task i/n]`), one `--- ✓|✗|⚠ TASK i/n: <goal>  (status=<s>, …) ---` section per task of a batch,
  `Total duration: <x>s` (batch) or `Status: <s> … Duration: <x>s` (single child). Indexes: `task_index` base 0,
  headers base 1. A muted notice is `display_kind: "hidden"` (served with `content: ""` when diagnostic).
- Each child has its own session, created when it is queued (`tools/delegate_tool_child_run.py`): `source:
  "subagent"` (under the messaging gateway it may inherit the gateway's source and carry `is_internal_child: true`),
  `parent_session_id` = the parent, first user message = the goal. `GET /api/sessions?include_children=true` lists them
  (`last_active`, `tool_call_count`, `api_call_count`, `ended_at`, `end_reason`, `preview` = first 60 characters +
  `...`); without `include_children` they are hidden. No HTTP route gives more progress.

## Guardrails, run control (read in the 0.23.0 source, 2026-11-12; the Garde-fous tab is tied to these names)

- No pause of a run, and **no token or cost limit per run**. Run control on the API server: `steer` (text given
  after the current tool batch, 409 when the run is not `running`), `stop`, `approval`, `clarify`.
- `agent.run_budget_seconds` (None = off): at 80 % a one-time « wrap up » note is added to a tool result; no hard
  stop. `agent.max_turns` (None = unlimited) and `agent.budget_warning_ratio` (warning before `max_turns`). The
  schema types these None-default keys `string`: Intendia sends a number, or `null` to go back to « no limit ».
- `tool_loop_guardrails`: `warnings_enabled` (true), `hard_stop_enabled` (false), `non_interactive_hard_stop_enabled`
  (true), `warn_after.*` and `hard_stop_after.{exact_failure,same_tool_failure,idempotent_no_progress}`,
  `loop_caps.{max_web_searches,max_subagents}` (always on, 0 = off). « Attended » platforms (`cli`, `tui`, `desktop`,
  `acp`, `subagent`, `api_server`: `agent/tool_guardrails.py:86`) only hard-stop with `hard_stop_enabled`; cron and
  kanban sessions hard-stop by default.
- `delegation.max_concurrent_children` (10) and `delegation.max_spawn_depth` (1) are read again at each call;
  `agent.*` and `tool_loop_guardrails` are fixed when a session's agent is built (the gateway keeps it 1 h idle).
  `kanban.max_in_progress` (None = from RAM, 2 to 8) and `kanban.max_in_progress_per_profile`: next dispatcher pass
  (`kanban.dispatch_interval_seconds`, 60).

## First run (read in the 0.23.0 source, `web_routers/models.py`, 2026-11-12)
- `GET /api/model/info` never writes; without `model.default` it answers `model: ""` (and the provider of the file).
- `GET /api/model/recommended-default?provider=` → `{provider, model, free_tier}`: the curated pick of an authenticated
  provider (`pick_silent_default_model`), `""` for an unknown or unauthenticated one; `free_tier` for Nous only. It
  goes through `build_models_payload`, so it may write the discovered models of custom endpoints (like `model/options`).
  Never probed by the compatibility check.

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

