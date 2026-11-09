# Intendia

Web UI for Hermes Agent, through its HTTP APIs only. Read docs/architecture.md before changing connectors.

- Never call Hermes outside `apps/server/src/{hermes,connectors,compat,cli}`; never read Hermes files or import its code.
- A new Hermes route = a candidate route in the module's connector + a tolerant zod schema; record fixtures with
  `pnpm probe record` and keep tests passing against `apps/fake-hermes`.
- DB migrations: SQL files in `apps/server/src/db/migrations/`, additive only (new tables / columns).
- UI text in French; code, comments and docs in English.
