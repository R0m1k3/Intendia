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

Do not publish 8642 or 9119 on the host nor in your reverse proxy: these keys control the whole agent, terminal included.

**Multi-profile routing**: each `/p/<profile>/` prefix has its own API key; add them to the instance as `profileKeys`.

## 2. Intendia

```bash
mkdir intendia && cd intendia
curl -O https://raw.githubusercontent.com/R0m1k3/Intendia/main/docker-compose.example.yml
curl -o .env https://raw.githubusercontent.com/R0m1k3/Intendia/main/.env.example
mv docker-compose.example.yml docker-compose.yml
```

Edit `.env`: `INTENDIA_PUBLIC_URL` (your domain) and `INTENDIA_SECRET` (`openssl rand -hex 32`).
Edit `docker-compose.yml`: the names of the Hermes workspace volume, the Hermes network and your reverse-proxy network.
`PUID`/`PGID` must own the workspace volume (official Hermes image: 10000).

```bash
docker compose up -d
docker logs intendia      # shows the one-time installation code
```

Open your domain, enter the installation code, choose a password, then add an instance: Intendia tests every module
against it and shows the result before saving. Instance keys are encrypted in the database and never sent back to the
browser. To declare instances in the environment instead, use `INTENDIA_INSTANCES` (see `.env.example`).

## 3. Reverse proxy

Point your proxy at `intendia:3000`. Chat answers are streamed (SSE): disable response buffering.

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

Never expose port 3001: it is the MCP endpoint for the agents (coming with the files phase).

## 4. Updates

- **Hermes** can stay on `latest`. After each update Intendia re-tests every module; the State screen shows the result,
  and `INTENDIA_WEBHOOK_URL` can notify you when a module changes state.
- **Intendia** publishes `X.Y.Z`, `X.Y` and `X` tags. Follow the major tag (`:1`) to receive fixes only.
- **Database**: before each migration Intendia copies it with `VACUUM INTO` into `/data/backups/` (last five kept).
  Migrations only add tables or columns, so going back one version works without a restore.
