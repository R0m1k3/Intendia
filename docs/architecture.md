# Architecture

```
apps/server        Hono on Node 24: /x/* API, static SPA, (later) MCP on 3001
  src/hermes/      http.ts — the only HTTP client to Hermes; surface.ts — discovery
  src/connectors/  one folder per module: operations, candidate routes, zod schemas
  src/compat/      engine (route resolution + probes), service (scheduling, history), notify (webhook)
  src/cli/         probe (record / diff), hash-password
apps/web           React 19, Vite, TanStack Router + Query, Tailwind 4
apps/fake-hermes   replays fixtures/ as both Hermes APIs; can break routes on demand
fixtures/          probe recordings, one folder per Hermes version
```

## How a module stays alive across Hermes updates

Each operation of a module (`connectors/<module>/index.ts`) declares:

- `kind`: read or write; `required` reads are needed for the module to work at all;
- `routes`: candidate routes by preference, each on the API server (`api`) or the dashboard (`dash`);
  an API server route may name its `capability` (key in `/v1/capabilities.endpoints`) and `feature` flag;
- `schema`: tolerant zod schema of the fields Intendia reads (`looseObject`: unknown fields are kept).

The compatibility engine (`compat/engine.ts`), for every operation, walks its routes:

1. API server route: skipped if the API is unreachable, if its feature flag is `false`, or if its capability is
   missing from `/v1/capabilities`. When the capability exists, **its announced path replaces the default one**:
   a route moved by Hermes is followed without a code change.
2. Dashboard route: skipped if no dashboard is configured or reachable, or if the route is absent from `/openapi.json`.
3. Read routes without parameters are called and validated against the schema; a failure moves on to the next route.

Module state: `unavailable` if a required read has no working route, `readonly` if a write has none, `full` otherwise.
At runtime `connectors/runtime.ts` (`callOp`, `streamOp`) only uses the route chosen by the last report.

Checks run at start-up, when `/health/detailed` announces a new version (polled every 5 minutes), every 24 h and on
demand from the State screen. State changes go to the webhook.

## Rules (enforced by `apps/server/test/boundaries.test.ts`)

- Only `src/hermes`, `src/connectors`, `src/compat` and `src/cli` import `hermes/http.ts`.
- No reference to Hermes files (`config.yaml`, `state.db`, `gateway_state.json`) nor to its Python code.

## When Hermes changes

1. The State screen (or the weekly CI issue) names the operation and the route.
2. `pnpm probe record` against the new version, then `pnpm probe diff fixtures/hermes-<old> fixtures/hermes-<new>`.
3. Fix the connector (new candidate route or schema field), commit the new fixtures; the tests replay them.
