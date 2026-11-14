# Installing Intendia

Intendia runs next to your Hermes Agent containers, in the same Docker network, behind your reverse proxy.
Nothing in the Hermes image changes; you only set a few environment variables on the Hermes side.

## 1. Hermes side (once per instance)

**API server** (port 8642), in the Hermes environment (`.env` of `HERMES_HOME`, or the container env):

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<openssl rand -hex 32>     # at least 16 characters
API_SERVER_HOST=0.0.0.0                   # listen inside the container; do NOT publish 8642
```

**Dashboard** (port 9119, needed for the console: settings, skills, agents, kanban, crons). On a non-loopback address
Hermes always requires authentication; give it a token reserved for Intendia:

```bash
HERMES_DASHBOARD_SESSION_TOKEN=<openssl rand -hex 32>   # or file:/run/secrets/hermes_dashboard_token
hermes dashboard --host 0.0.0.0 --no-open               # official image: command ["dashboard", "--host", "0.0.0.0", "--no-open"]
```

**Workspace files**: Intendia reads and writes the workspaces through the dashboard's file API, confined to one folder.
Set it, in the environment of the **dashboard** container:

```bash
HERMES_DASHBOARD_FILES_ROOT=/opt/data/workspace   # any folder that does not contain HERMES_HOME
```

The agent must run its terminal in the Hermes container (`terminal.backend: local`, the default) so that it sees the
same paths. Without this variable (or with a root that contains Hermes' configuration, such as `/opt/data`), the
**Files** module of the instance stays unavailable and no workspace can be created on it; Settings shows the reason
and the line to add. After changing it, restart Hermes and click “Check again” on the Status page.

Do not publish 8642 or 9119 on the host nor in your reverse proxy: these keys control the whole agent, terminal included.

**Multi-profile routing**: each `/p/<profile>/` prefix has its own API key; add them to the instance as `profileKeys`.

**Chatting with a new agent**: an agent created from the Agents page (a Hermes profile) has no key in Intendia yet;
its page says "clé manquante". Give its profile an API server key in Hermes, then add it to the instance:
- instance declared in `INTENDIA_INSTANCES`: add `"profileKeys": {"<name>": "<key>"}` to that instance, restart
  Intendia;
- instance added from the setup page: send its whole configuration again with `POST /x/instances` (same `id`, API key
  and dashboard token included, since a saved instance is replaced), with every `profileKeys` entry it should keep.

## 2. Intendia

```bash
mkdir intendia && cd intendia
curl -O https://raw.githubusercontent.com/R0m1k3/Intendia/main/docker-compose.example.yml
curl -o .env https://raw.githubusercontent.com/R0m1k3/Intendia/main/.env.example
mv docker-compose.example.yml docker-compose.yml
```

The image is `ghcr.io/r0m1k3/intendia`. While the repository is private, the image is too: log in once with a GitHub
token that has `read:packages` (`echo <token> | docker login ghcr.io -u <user> --password-stdin`).

Edit `.env`: `INTENDIA_PUBLIC_URL` (your domain) and `INTENDIA_SECRET` (`openssl rand -hex 32`).
Edit `docker-compose.yml`: the names of the Hermes network and your reverse-proxy network.
`PUID`/`PGID` must own the data volume.

### Workspace files

Intendia mounts no workspace volume. Each workspace is a folder `<root>/<slug>/` (`files/`, `inbox/`, `sessions/`,
`AGENTS.md`) kept by the Hermes of its instance, where `<root>` is that Hermes' `HERMES_DASHBOARD_FILES_ROOT` (read
during the instance check, shown in Settings). Every file action goes to that Hermes only, so two instances never share
their files. Limits that come from Hermes' file API: 100 MB per file, folders cannot be moved, names Hermes hides
(`.env`, `config.yaml`, `auth.json`…) are not shown, and symbolic links are never opened, written, moved nor deleted.

**Upgrading from 0.0.3 or earlier** (shared workspace volume):
1. Add `HERMES_DASHBOARD_FILES_ROOT=/opt/data/workspace` to each Hermes dashboard container, so that the root is the
   folder that already held the workspaces, and restart it.
2. Remove the `workspace` volume from Intendia's compose file (the `mount`/`agentMount` keys of `INTENDIA_INSTANCES` are
   ignored, with a warning in the logs), then restart Intendia and click “Check again” on each instance.
3. A second instance used to write its workspaces into the volume of the first one: copy those folders into the root of
   the right Hermes. Until then their page says « Dossier introuvable chez <instance> ».

```bash
docker compose up -d
docker logs intendia      # shows the one-time installation code
```

Open your domain, enter the installation code, choose a password, then add an instance: Intendia tests every module
against it and shows the result before saving. Instance keys are encrypted in the database and never sent back to the
browser. To declare instances in the environment instead, use `INTENDIA_INSTANCES` (see `.env.example`).

## 3. Reverse proxy

Point your proxy at `intendia:3000`. Chat answers are streamed (SSE): disable response buffering.
Serve Intendia over HTTPS with HTTP/2 (the default of the three proxies below): over HTTP/1.1 a browser opens only six
connections per site, and every chat followed live on the Chat page holds one (Intendia follows at most three live per tab,
the others every few seconds).

**Nginx Proxy Manager**: proxy host to `intendia` port `3000`, "Websockets support" on, and in *Advanced*:

```nginx
proxy_buffering off;
proxy_read_timeout 1h;
```

**Caddy**:

```caddy
intendia.example.com {
  reverse_proxy intendia:3000 {
    flush_interval -1
  }
}
```

**Traefik** (labels on the `intendia` service):

```yaml
- traefik.enable=true
- traefik.http.routers.intendia.rule=Host(`intendia.example.com`)
- traefik.http.routers.intendia.tls.certresolver=letsencrypt
- traefik.http.services.intendia.loadbalancer.server.port=3000
```

Uploads are streamed up to `INTENDIA_UPLOAD_MAX_MB` (default and maximum 100, the limit of Hermes' file API): let the proxy accept bodies that big
(Nginx Proxy Manager, *Advanced*: `client_max_body_size 200m;`).

Never expose port 3001: it is the MCP endpoint for the agents (next section).

## 3a. MCP servers connected by OAuth (Configuration › MCP)

Most servers of Hermes' MCP catalog (Notion, Linear, Airtable…) sign in by OAuth: the provider sends your browser
back to a **return URL**. Hermes would use the address Intendia uses to reach its dashboard (`http://hermes:9119`),
which your browser cannot open. Intendia picks the return URL in this order:

- `mcp_servers.<name>.oauth.redirect_uri` already set in Hermes' config (and not Intendia's): kept as is;
- `dashboard.public_url` set in Hermes' config: Hermes' own public callback;
- `INTENDIA_PUBLIC_URL` set: Intendia writes `<INTENDIA_PUBLIC_URL>/x/mcp-oauth/<instance>/<name>/callback` as the
  server's `redirect_uri` and passes the return on to the dashboard;
- none: the connection is refused and Intendia asks you to set `INTENDIA_PUBLIC_URL`.

The return route is public (the provider's redirect carries no Intendia session). It only passes on a return for a
connection Intendia started itself in the last 15 minutes (matched by its `state`), once, and is limited to
10 requests per minute and per IP. Some providers (Asana…) need your own OAuth app: give it this return URL.

## 3b. The `share_file` tool (links for Telegram and crons)

Intendia exposes one MCP tool to the agents, `share_file(path)`: it creates (or reuses) a **private** link
`<INTENDIA_PUBLIC_URL>/f/<token>` to a file of a workspace (under the workspace root of its instance) and returns it, so the agent can give a link
from Telegram or a cron. The agent can never create a public link; you make a link public (with an expiry date,
365 days at most) or revoke it on the **Liens** screen.

- Port 3001 must be reachable from the Hermes containers only (same Docker network, see `docker-compose.example.yml`).
- Each instance has its own address `http://intendia:3001/mcp/<instance-id>` and its own bearer token. Deleting
  the instance from Intendia deletes its token; changing `INTENDIA_SECRET` does not change it.
- If Hermes reaches Intendia under another name or port, set `INTENDIA_MCP_URL` (for example
  `http://intendia-prod:3001`); Intendia appends `/mcp/<instance-id>`.
- `INTENDIA_PUBLIC_URL` must be set, otherwise the tool returns `/f/<token>` alone, which only works inside Intendia.

Intendia connects the tool itself, through the Hermes dashboard API (`default` profile):

- when you add an instance, Intendia writes the `intendia` MCP server into Hermes if no server of that name exists;
- Settings → "Partage de fichiers" shows the state for each instance and a **Brancher Intendia à …** button: Intendia
  writes the entry, Hermes tests the connection (it must list `share_file`), then Intendia offers the restart. Hermes
  only loads the tool after its gateway restarts;
- the token is stored by Hermes in its env file (`MCP_INTENDIA_API_KEY`), never in clear in its config. An old block
  pasted by hand is replaced; another server named `intendia` (other URL) is replaced only after you confirm;
- "Régénérer le jeton" sends the new token to Hermes as well; restart Hermes afterwards.

If the instance does not allow these writes, Settings shows the block to add by hand under "Configuration manuelle":

```yaml
mcp_servers:
  intendia:
    url: http://intendia:3001/mcp/hermes
    headers:
      Authorization: "Bearer <token from Settings>"
```

In Intendia chats the framing block already asks the agent to call `share_file` for each delivered file. For Telegram
and crons, give the same rule with a short Hermes skill, for example:

```markdown
---
name: share-delivered-files
description: Give a link for every file you deliver.
---
When you deliver a file (report, export, image, document), call the `share_file` tool with its absolute path
and give the returned link in your answer. Never paste the file's content instead of the link.
```

## 4. Updates

- **Hermes** can stay on `latest`. After each update Intendia re-tests every module; the State screen shows the result,
  and `INTENDIA_WEBHOOK_URL` can notify you when a module changes state.
- **Intendia** publishes `X.Y.Z`, `X.Y`, `X` and `latest` tags for every release. Before 1.0, follow the minor tag
  (`:0.1`): the `:0` and `:latest` tags also move to any later `0.y` release, which may change behaviour. From 1.0,
  follow the major tag (`:1`) to receive fixes and compatible additions only.
- **Database**: before each migration Intendia copies it with `VACUUM INTO` into `/data/backups/` (last five kept).
  Migrations only add tables or columns, so going back one version works without a restore.
