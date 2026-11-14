# Intendia

Intendia is a web interface for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It runs as a single
container next to your Hermes instances and lets you work with the agent (chat, workspaces, files) and administer it
(crons, skills, models, providers, profiles, kanban, memory) from one place, in English or French.

Intendia talks to Hermes only through its HTTP APIs: the API server (port 8642) and the dashboard (port 9119). It never
imports the agent's code and never reads or writes its files, so Hermes can keep updating itself on its `latest` tag.

| | |
|---|---|
| ![Home: ask Hermes, recent sessions of every source](docs/screenshots/home.png) | ![Chat](docs/screenshots/chat.png) |
| ![File produced by the agent](docs/screenshots/session-files.png) | ![Kanban](docs/screenshots/kanban.png) |
| ![Crons](docs/screenshots/crons.png) | ![Skills](docs/screenshots/skills.png) |
| ![Hermes settings](docs/screenshots/settings.png) | ![State of each module](docs/screenshots/state.png) |

## Status

Version 0.1.x. Every module is tested against a fake Hermes that replays recordings of real instances, and checked by
hand on a reference Hermes 0.23. Intendia has not yet been run for long on a production installation, so there is no
1.0 yet. Expect rough edges and report them.

## What you can do

### Work with the agent

- Chat with Hermes in streamed sessions: tool calls, approvals (once, for the session, always, or deny), clarification
  questions, to-do lists, sub-agents (including background sub-agents, with an automatic follow-up once their results
  arrive), the cost and token count of each run, and a context gauge.
- Choose the model, the reasoning effort, the personality and the profile per session. Queue messages while the agent
  works, steer it mid-run, stop it, or switch on YOLO mode to approve everything for one session.
- Give a session a goal (`/goal`): Intendia keeps the agent working until it reports the goal reached or blocked,
  within a budget you set.
- Open up to four sessions side by side on the Chat page, and keep a side chat next to any page.
- Browse every session of an instance, whatever started it (Intendia, CLI, Telegram, Discord, crons, kanban): search,
  pin, rename, copy, move to another workspace, export (Markdown, HTML, JSON) or delete.
- Group sessions in workspaces. A workspace is a real folder that the agent works in; its files can be browsed,
  previewed (code, Markdown, PDF, images, CSV, Office documents, Excalidraw), uploaded, renamed, moved and
  downloaded as zip.
- Use git in a workspace: status, diff, stage, and commit with a message written by the agent.
- Get links to the files the agent delivers. Intendia gives Hermes a `share_file` MCP tool, so a cron or a Telegram
  conversation can answer with a private link to a file.

### Administer Hermes

- Crons: create, edit, pause, run now, follow their runs, start from templates.
- Skills: browse the hub, install (after Hermes' security scan), update, edit or archive skills the agent wrote.
- Configuration: main and auxiliary models, providers (subscriptions by device code, API keys, key pools, custom
  OpenAI-compatible endpoints, Anthropic setup-token), Hermes settings as a form or as YAML with history and diff,
  environment variables, MCP servers (with a catalog and OAuth), messaging platforms, plugins, and guardrails.
- Agents: Hermes profiles with their own model, keys and gateway; the Activity page lists what runs on every instance.
- Kanban: boards, tasks, live updates, and missions (Hermes splits a goal into tasks that you review before they run).
- Monitor: usage and cost per day, logs, and server metrics.
- Memory: the agent's built-in memory and what it has learned.
- Site access: logins, cards and addresses kept in the Hermes credential vault, for the browser tool.

### Several instances

One Intendia can drive several Hermes instances (for example a personal one and a work one). Sessions, activity and
files stay separate per instance; the switcher at the top of the sidebar chooses the current one.

## How it survives Hermes updates

- Each module (chat, sessions, crons, skills, configuration, agents, kanban, files, memory...) has its own connector
  with tolerant zod schemas. Nothing else in the code calls Hermes, and a test enforces it.
- Routes are discovered, not assumed. For each operation Intendia lists the possible routes by preference. At start-up,
  on each new Hermes version and once a day, it keeps the first route the instance really offers (from
  `/v1/capabilities` and the dashboard's `/openapi.json`), then calls the read routes and validates their answers.
- Each module is complete, read-only or unavailable, with the reason and a link to the same page of the official
  dashboard. One broken route turns off one feature, not the whole interface. The Status page shows all of it.
- A weekly CI job runs the official `nousresearch/hermes-agent:latest` image and opens an issue when an answer changes
  shape. An optional webhook (`INTENDIA_WEBHOOK_URL`) tells you when a module of your own instances changes state.

## Install

Intendia joins the Docker network of your Hermes stack and sits behind your reverse proxy. On the Hermes side you only
enable the API server and the dashboard and give Intendia their keys. The full guide, including the reverse proxy and
the `share_file` tool, is in [docs/install.md](docs/install.md). In short:

```bash
mkdir intendia && cd intendia
curl -O https://raw.githubusercontent.com/R0m1k3/Intendia/main/docker-compose.example.yml
curl -o .env https://raw.githubusercontent.com/R0m1k3/Intendia/main/.env.example
mv docker-compose.example.yml docker-compose.yml
# edit .env (INTENDIA_PUBLIC_URL, INTENDIA_SECRET) and the two network names in docker-compose.yml
docker compose up -d
docker logs intendia     # prints the installation code asked by the web UI on first start
```

Open the public address, enter the installation code, choose a password, then add your Hermes instances (or declare
them in `INTENDIA_INSTANCES`). A short first-run guide helps you pick a provider, a model and a first workspace.
A `docker-compose.portainer.yml` builds the image from the repository for Portainer stacks.

The image is `ghcr.io/r0m1k3/intendia`, tagged `X.Y.Z`, `X.Y`, `X` and `latest`. Until 1.0, follow the minor tag
(`:0.1`).

### Main settings

| Variable | Purpose |
|---|---|
| `INTENDIA_SECRET` | Signs cookies and links, encrypts the instance keys stored in the database (at least 32 characters, `openssl rand -hex 32`). |
| `INTENDIA_PUBLIC_URL` | Public address, used for links given by the agent (Telegram, crons) and for MCP OAuth callbacks. |
| `INTENDIA_PASSWORD_HASH` | Optional argon2id hash of the password. Empty: the web UI asks for one on first start. |
| `INTENDIA_INSTANCES` | Optional JSON list of instances; they are then read-only in the UI. |
| `INTENDIA_MCP_URL` | Address Hermes uses to reach Intendia's MCP port (default `http://intendia:3001`). |
| `INTENDIA_WEBHOOK_URL` | Optional webhook called when a module changes state after a Hermes update. |
| `INTENDIA_UPLOAD_MAX_MB` | Largest upload in MB (default and maximum 100). |
| `PUID` / `PGID` | Owner of the data volume. |

The full list is in [.env.example](.env.example).

## Security

- The web UI is protected by one password (argon2id), an `HttpOnly`, `SameSite=Strict` session cookie, and a limit of
  five sign-in attempts per minute and per address. API calls also require a custom header.
- Instance keys are encrypted at rest with `INTENDIA_SECRET`. Secrets read from Hermes (API keys, tokens, vault
  entries) are masked and never sent back to the browser.
- Ports 8642 and 9119 of Hermes, and Intendia's MCP port 3001, must stay on the Docker network; never publish them.
- Share links are random, can be revoked, and serve files only from the workspaces of their instance.

## Language

The interface is in English and French. By default it follows the browser language (French for a French browser,
English otherwise); Settings > Display > Language overrides it for that browser. Server messages follow the same choice.

## Development

```bash
corepack enable
pnpm install
pnpm dev:fake                 # fake Hermes replaying fixtures/ on 18642 / 19119
INTENDIA_SECRET=$(openssl rand -hex 32) INTENDIA_DATA_DIR=.data pnpm dev
pnpm test                     # web tests, and server tests against the fake Hermes
pnpm -r typecheck
```

`pnpm probe record` records a real instance (read-only) into `fixtures/hermes-<version>/`, and `pnpm probe diff A B`
compares two recordings. Read [docs/architecture.md](docs/architecture.md) before changing a connector. Interface
texts are written in French inside `t()` with their English in `apps/web/src/i18n/en/`; the completeness test fails
when one is missing.

## License

MIT
