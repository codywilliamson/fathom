# fathom

Claude Code usage across every machine, on one glanceable display. PWA served
over Tailscale, built for an always-on fire hd 10 kiosk (landscape) but still
usable on a phone. Bun backend + Vue 3 SPA. Inherits the porthole/buoy house
pattern: stack, security model, design language, and PWA update mechanism.

Design and rationale: `docs/design.md`.

## module map (SRP)

- `src/index.ts` — entry: open db, start scanner, start ratelimit poller, start server.
- `src/server.ts` — thin `Bun.serve` route map + static `dist/` serving. no domain logic;
  new concerns get their own `src/` module.
- `src/config.ts` — the ONLY place env is read. everything else imports `config`.
- `src/db.ts` — migrations + `openDb(path)`. only place schema lives.
- `src/store.ts` — the `Store` class. ALL sql lives here. takes an injectable
  `Database` so tests use `:memory:` — keep that seam.
- `src/scanner.ts` — tails `~/.claude/projects/**/*.jsonl` from a byte cursor.
- `src/ratelimit.ts` — quota windows from the unified rate-limit headers.
- `src/summary.ts` — composes `SummaryResponse`. no sql of its own.
- `src/stream.ts` — SSE fan-out + `notifyChange()`, the one change emitter.
- `shared/types.ts` — single source of truth for the `/api/v1` contract. import it,
  never redefine the shapes in `src/`, `web/`, or `agent/`.
- `shared/jsonl.ts` — transcript parser. pure. shared with the windows agent.
- `shared/pricing.ts` — model rates + `costOf()`. pure.
- `agent/` — the standalone windows push agent. see `docs/windows-setup.md`.
- `web/` — Vue 3 SPA, built by Vite into `dist/`, served by the backend.

## things that will bite you

- **dedup on `message.id` is not optional.** claude code rewrites the same
  assistant line repeatedly while streaming; on real transcripts that's a 2.38x
  over-count. `message_id` is the sqlite PK, which is also what makes ingest
  idempotent and lets the windows agent retry freely.
- **cost is notional.** cody is on a max plan; the dollars are what the tokens
  would have cost on the api. label them that way in any new ui.
- **quota windows come from response headers, not a usage endpoint.**
  `anthropic-ratelimit-unified-*` rides every `/v1/messages` reply, so we send a
  minimal probe to read them. `GET /api/oauth/usage` looks like the right answer
  and isn't: its budget is tiny and its window is ~33min, so any useful poll
  rate keeps it exhausted. if the headers ever vanish, `normalizeWindows()`
  returns `[]` and the ui falls back to rolling token volume — never a made-up
  percentage.
- **never `pkill -f 'bun src/index.ts'`** — every sibling fleet service shares
  that command line. kill by port or pid.

## design system

deep-sea instrument panel language (inherited from porthole). Tokens live in
`web/src/style.css`; don't invent values. fathom's accent is bioluminescent
green — one accent per tool is how they're told apart on the home screen.

## design system

deep-sea instrument panel language (inherited from porthole). Tokens live in
`web/src/style.css`; don't invent values.

## commands

```sh
bun install
bun run dev       # backend, --watch, port 4950
bun run dev:web   # vite dev server, proxies /api
bun run build     # vue-tsc + vite build -> dist/
bun start         # bun src/index.ts, serves everything
bun test          # bun test
bun run typecheck # vue-tsc --noEmit
```

## env vars

See `.env.example` — all optional with sane defaults. `src/config.ts` is the only reader.

- `FATHOM_PORT` (default `4950`)
- `FATHOM_ALLOWED_HOSTS` (default empty = any; comma-separated `host:port` allowlist)
- `FATHOM_MACHINE` (default hostname) — recorded on every event this machine ingests
- `FATHOM_CLAUDE_DIR` (default `~/.claude`)
- `FATHOM_DB_PATH` (default `data/fathom.sqlite`)
- `FATHOM_SCAN_INTERVAL_SEC` (default `20`)
- `FATHOM_RATELIMIT_INTERVAL_SEC` (default `600` — keep it slow, see above)
- `FATHOM_ACTIVE_WINDOW_SEC` (default `900`) — session counts as active
- `FATHOM_STALE_SEC` (default `300`) — machine counts as online
- `FATHOM_INGEST_TOKEN` (default empty = check skipped) — shared secret the
  windows agent sends as `x-fathom-token`

## HARD INVARIANTS

- Tailscale is the security perimeter. There is no auth by design — do not add auth, do
  not expose this publicly. Bind stays `0.0.0.0` so the tailnet reaches it.
- Keep the defenses: Host-header allowlist (`FATHOM_ALLOWED_HOSTS`), and
  origin check + required `application/json` content-type on every POST
  (`crossSiteBlock` in `src/server.ts` — new write routes go through it for free).
- The service worker is hand-rolled (`web/public/sw.js`). Bump the cache key
  `fathom-shell-vN` whenever sw logic changes; `/api/*` is NEVER cached by the sw.
- Subprocesses (if you add any) are argv-only (`Bun.spawn` arrays) — never build shell
  strings from external data.

## repo tooling

- **commit-guard** enforces conventional commits via `.githooks/commit-msg` +
  `.github/workflows/commitlint.yml` (pinned `@v0.2.2`).
- `git config core.hooksPath .githooks` after clone.
