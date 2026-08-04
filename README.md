# fathom

claude code usage across every machine you work on, on one always-on display.
mobile-first pwa served over tailscale, built for a docked kiosk tablet — no
more tabbing to a terminal to ask "how much have i used, and can i keep going".

> **tailscale is the security perimeter. there is no auth by design. never
> expose this publicly** — fathom has no login screen and isn't meant to.

## the problem

claude code runs on two machines here — a linux laptop and a windows desktop.
usage lives in per-machine `~/.claude/projects/**/*.jsonl` transcripts, and the
5-hour / weekly quota windows only surface in api response headers. fathom
pulls both onto
one glanceable screen instead of leaving the question unanswered until you go
check.

## stack

- **bun** backend: local transcript scanner (`bun:sqlite`), quota-header
  probe, rollups, sse live updates
- **vue 3 + vite** spa, hand-written service worker, deep-sea instrument
  panel design language (shared with porthole/buoy/helm)
- `shared/types.ts` is the single source of truth for the versioned
  `/api/v1` contract — backend, web, and the windows agent all import it

## quickstart

```sh
bun install
cp .env.example .env
bun run build
bun start          # http://<tailscale-host>:4950
```

dev mode (two processes):

```sh
bun run dev        # backend, --watch, port 4950
bun run dev:web    # vite dev server, proxies /api
```

tests: `bun test` · typecheck: `bun run typecheck`

## architecture

one bun service on the laptop owns the database and the dashboard. the
windows desktop runs a small agent that parses its own transcripts and pushes
the deltas over the tailnet — push, not pull, because the laptop is the
machine that sleeps.

```
windows desktop                        laptop (this machine)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ ~/.claude/projects/  │               │ ~/.claude/projects/             │
│         │            │               │         │                       │
│   agent/agent.ts     │  POST         │   src/jsonl.ts (local tail)     │
│   (task scheduler,   │──/api/v1/─────▶         ↓                       │
│    every 2 min)      │  ingest       │   src/store.ts (bun:sqlite)     │
└──────────────────────┘               │         ↑                       │
                                       │   src/ratelimit.ts (quota hdrs) │
                                       │         ↓                       │
                                       │   src/summary.ts → SSE + REST   │
                                       └────────────┬────────────────────┘
                                                    │ tailnet
                                              ┌─────▼──────┐
                                              │ fire hd 10 │
                                              │ fully kiosk│
                                              └────────────┘
```

full writeup, including why `messageId` dedup matters (claude code rewrites
the same assistant line repeatedly while streaming — naive summing
over-counts tokens by roughly 3x): [docs/design.md](docs/design.md).

## data sources

- **jsonl transcripts** — the reliable one. every assistant turn in
  `~/.claude/projects/**/*.jsonl` carries token usage; fathom tails these
  incrementally and dedupes on `message.id`. this is the primary display,
  not a fallback.
- **the unified rate-limit headers** — the 5-hour and weekly quota gauges.
  `anthropic-ratelimit-unified-*` comes back on every `/v1/messages` response,
  so fathom sends a minimal probe (cheapest model, `max_tokens: 1`) just to
  read them. each poll costs a handful of tokens; that's the price of live
  quota numbers.

  the obvious candidate, `GET /api/oauth/usage`, turned out to be a dead end:
  it works, but its budget is tiny and its window long — an observed 429 said
  `retry-after: 1963` (~33 min), so any useful poll rate keeps it permanently
  exhausted. the headers ride a normal call instead and are always current.

  if the headers ever stop appearing, the gauges fall back to rolling token
  volume from the transcripts rather than inventing a percentage.

dollar figures throughout are **notional api-equivalent cost** — the author
is on a Max subscription, so nothing here reflects real spend. it's a way to
compare usage across models and machines, not a bill.

## env vars

all optional with sane defaults; `src/config.ts` is the only reader. see
[.env.example](.env.example).

| var | default | notes |
|---|---|---|
| `FATHOM_PORT` | `4950` | |
| `FATHOM_ALLOWED_HOSTS` | empty (any) | comma-separated `host[:port]` allowlist, dns-rebinding defense |
| `FATHOM_MACHINE` | hostname | id recorded on every event this machine ingests |
| `FATHOM_CLAUDE_DIR` | `~/.claude` | where the transcripts live |
| `FATHOM_DB_PATH` | `data/fathom.sqlite` | |
| `FATHOM_SCAN_INTERVAL_SEC` | `20` | how often to tail the transcripts |
| `FATHOM_RATELIMIT_INTERVAL_SEC` | `600` | quota probe cadence; each probe costs a few tokens |
| `FATHOM_ACTIVE_WINDOW_SEC` | `900` | a session is "active" if it had a message this recently |
| `FATHOM_STALE_SEC` | `300` | a machine is "online" if seen this recently |
| `FATHOM_INGEST_TOKEN` | empty (check skipped) | shared secret the windows agent sends as `x-fathom-token` |

the agent side has its own vars — see [docs/windows-setup.md](docs/windows-setup.md).

## docs

- [docs/design.md](docs/design.md) — full architecture, data model, and the
  design decisions behind them
- [docs/windows-setup.md](docs/windows-setup.md) — setting up the windows
  desktop agent
- [docs/tablet-setup.md](docs/tablet-setup.md) — kiosking the display on a
  fire hd 10
- [deploy/README.md](deploy/README.md) — systemd user service install

## credit

scaffolded from [codywilliamson/shipwright](https://github.com/codywilliamson/shipwright).

## license

MIT — see [LICENSE](LICENSE).
